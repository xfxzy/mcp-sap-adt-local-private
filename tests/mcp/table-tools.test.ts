import { afterEach, describe, expect, it, vi } from "vitest";
import type { TableReader } from "../../src/adt/table-reader.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { registerTableTools } from "../../src/tools/read/table-tools.js";
import { startTestMcpServer, type TestMcpClient } from "../helpers/mcp.js";

const config = parseSystemsConfig({
  version: 1,
  systems: [
    {
      id: "SAH",
      label: "SAH Client 400",
      kind: "s4hana-op",
      environment: "non-production",
      connection: {
        protocol: "https",
        host: "sap.example.com",
        port: 44300,
        client: "400",
        language: "1",
        serverTimezone: "Asia/Shanghai",
      },
      auth: { type: "basic", username: "DEMO_USER", credentialRef: "SAH" },
      tls: {
        mode: "pinned",
        fingerprintSha256: "AA".repeat(32),
        allowExpired: true,
      },
      access: {
        read: true,
        adtDevelopmentWrite: true,
        businessApiWrite: true,
      },
      development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
      businessApis: { enabledProfiles: [] },
      limits: {
        requestTimeoutMs: 30000,
        rateLimitPerMin: 60,
        maxSourceLines: 5000,
      },
    },
  ],
});

const clients: TestMcpClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function setup() {
  const registry = new SystemRegistry(config);
  registry.setActive(["SAH"]);
  const reader: TableReader = {
    readStructure: vi.fn(async () => ({
      tableName: "T001",
      columns: [
        { name: "BUKRS", dataType: "CHAR", length: 4, key: true },
        { name: "BUTXT", dataType: "CHAR", length: 25, key: false },
      ],
    })),
    readQuery: vi.fn(async (_system, sql) => ({
      sql,
      columns: ["BUKRS", "BUTXT"],
      rows: [{ BUKRS: "1000", BUTXT: "Test company" }],
    })),
  };
  const server = createMcpServer();
  registerTableTools(server, { registry, reader });
  const client = await startTestMcpServer({ server });
  clients.push(client);
  return { client, reader };
}

describe("table MCP tools", () => {
  it("registers structure and guarded read tools", async () => {
    const { client } = await setup();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "read_table_structure",
      "read_table",
    ]);
  });

  it("wires table tools into a runtime-context server", async () => {
    const server = createMcpServer({
      config,
      credentialStore: {},
      audit: {},
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const client = await startTestMcpServer({ server });
    clients.push(client);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["read_table_structure", "read_table"]),
    );
  });

  it("preserves column order and string identifiers", async () => {
    const { client, reader } = await setup();
    const structure = await client.callTool("read_table_structure", {
      systemId: "SAH",
      tableName: "T001",
    });
    expect(structure.structuredContent).toMatchObject({
      tableName: "T001",
      columns: [{ name: "BUKRS" }, { name: "BUTXT" }],
    });

    const data = await client.callTool("read_table", {
      systemId: "SAH",
      sql: "SELECT bukrs, butxt FROM t001 WHERE bukrs = '1000'",
      maxRows: 500,
    });
    expect(data.structuredContent).toMatchObject({
      columns: ["BUKRS", "BUTXT"],
      rows: [{ BUKRS: "1000", BUTXT: "Test company" }],
    });
    expect(reader.readQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/UP TO 500 ROWS$/i),
      500,
    );
  });

  it("rejects unsafe SQL before calling SAP", async () => {
    const { client, reader } = await setup();
    const response = await client.callTool("read_table", {
      systemId: "SAH",
      sql: "DELETE FROM mara",
    });
    expect(response.isError).toBe(true);
    expect(reader.readQuery).not.toHaveBeenCalled();
  });
});
