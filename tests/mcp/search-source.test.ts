import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepositoryReader } from "../../src/adt/repository-reader.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { registerSearchSourceTool } from "../../src/tools/read/search-source.js";
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

function reader(): RepositoryReader {
  return {
    search: vi.fn(async () => [{ name: "ZTEST", type: "PROG/P" }]),
    readSource: vi.fn(async () => ({
      source: "REPORT ztest.\nCALL FUNCTION 'BAPI_COMPANYCODE_GETLIST'.",
    })),
    getObjectStructure: vi.fn(),
    whereUsed: vi.fn(),
  };
}

async function setup() {
  const registry = new SystemRegistry(config);
  registry.setActive(["SAH"]);
  const repository = reader();
  const server = createMcpServer();
  registerSearchSourceTool(server, { registry, reader: repository });
  const client = await startTestMcpServer({ server });
  clients.push(client);
  return { client, reader: repository };
}

describe("search_source MCP tool", () => {
  it("registers search_source in isolation and runtime context", async () => {
    const { client } = await setup();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "search_source",
    ]);

    const runtimeServer = createMcpServer({
      config,
      credentialStore: {},
      audit: {},
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const runtimeClient = await startTestMcpServer({ server: runtimeServer });
    clients.push(runtimeClient);
    expect(
      (await runtimeClient.listTools()).tools.some(
        (tool) => tool.name === "search_source",
      ),
    ).toBe(true);
  });

  it("returns bounded source matches", async () => {
    const { client, reader } = await setup();
    const response = await client.callTool("search_source", {
      systemId: "SAH",
      pattern: "bapi_company",
      query: "Z*",
      objectType: "PROG/P",
      maxObjects: 5,
      maxResults: 10,
    });

    expect(response.structuredContent).toMatchObject({
      systemId: "SAH",
      pattern: "bapi_company",
      objectsScanned: 1,
      matches: [
        {
          objectName: "ZTEST",
          objectType: "PROG/P",
          lineNumber: 2,
        },
      ],
    });
    expect(reader.search).toHaveBeenCalledWith(expect.anything(), {
      query: "Z*",
      objectType: "PROG/P",
      maxResults: 5,
    });
  });
});
