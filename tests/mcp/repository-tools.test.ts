import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepositoryReader } from "../../src/adt/repository-reader.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import {
  REPOSITORY_TOOL_NAMES,
  type RepositoryToolDependencies,
  registerRepositoryTools,
} from "../../src/tools/read/repository-tools.js";
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
  const reader: RepositoryReader = {
    search: vi.fn(async () => [
      {
        name: "ZTEST",
        type: "PROG/P",
        uri: "/sap/bc/adt/programs/programs/ztest",
        packageName: "$TMP",
        description: "Test program",
      },
    ]),
    readSource: vi.fn(async () => ({
      source: "one\ntwo\nthree",
      uri: "/sap/bc/adt/programs/programs/ztest/source/main",
    })),
    getObjectStructure: vi.fn(async () => ({
      objectType: "PROG/P",
      objectName: "ZTEST",
      nodes: [{ id: "main", label: "Main source" }],
    })),
    whereUsed: vi.fn(async () => ({
      references: [
        {
          name: "ZCALLER",
          type: "PROG/P",
          uri: "/sap/bc/adt/programs/programs/zcaller",
          packageName: "$TMP",
          description: "Caller",
        },
      ],
    })),
  };
  const dependencies: RepositoryToolDependencies = {
    registry: new SystemRegistry(config),
    reader,
    sourceCache: undefined,
  };
  dependencies.registry.setActive(["SAH"]);
  const server = createMcpServer();
  registerRepositoryTools(server, dependencies);
  const client = await startTestMcpServer({ server });
  clients.push(client);
  return { client, reader };
}

describe("repository MCP tools", () => {
  it("registers five repository tools", async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual([
      "search_repository_object",
      "read_source_code",
      "read_source_range",
      "get_object_structure",
      "where_used",
    ]);
  });

  it("wires repository tools into a runtime-context server", async () => {
    const server = createMcpServer({
      config,
      credentialStore: {},
      audit: {},
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const client = await startTestMcpServer({ server });
    clients.push(client);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...REPOSITORY_TOOL_NAMES]));
  });

  it("enforces maxResults even when the reader returns too many hits", async () => {
    const { client, reader } = await setup();
    vi.mocked(reader.search).mockResolvedValue([
      { name: "ZONE", type: "PROG/P", description: "One" },
      { name: "ZTWO", type: "PROG/P", description: "Two" },
    ]);

    const search = await client.callTool("search_repository_object", {
      systemId: "SAH",
      query: "Z*",
      maxResults: 1,
    });

    expect(search.structuredContent).toMatchObject({
      count: 1,
      results: [{ name: "ZONE" }],
    });
  });

  it("searches, reads source, pages a range, reads structure, and finds references", async () => {
    const { client, reader } = await setup();
    const search = await client.callTool("search_repository_object", {
      systemId: "SAH",
      query: "ZTEST",
      objectType: "PROG/P",
      maxResults: 10,
    });
    expect(search.structuredContent).toMatchObject({
      count: 1,
      results: [{ name: "ZTEST", uri: "/sap/bc/adt/programs/programs/ztest" }],
    });

    const source = await client.callTool("read_source_code", {
      systemId: "SAH",
      objectType: "PROG/P",
      objectName: "ZTEST",
    });
    expect(source.structuredContent).toMatchObject({
      objectName: "ZTEST",
      lineCount: 3,
      source: "one\ntwo\nthree",
    });

    const range = await client.callTool("read_source_range", {
      systemId: "SAH",
      objectType: "PROG/P",
      objectName: "ZTEST",
      fromLine: 2,
      toLine: 3,
    });
    expect(range.structuredContent).toMatchObject({
      fromLine: 2,
      toLine: 3,
      lines: ["two", "three"],
    });

    const structure = await client.callTool("get_object_structure", {
      systemId: "SAH",
      objectType: "PROG/P",
      objectName: "ZTEST",
    });
    expect(structure.structuredContent).toMatchObject({ objectType: "PROG/P" });

    const whereUsed = await client.callTool("where_used", {
      systemId: "SAH",
      objectType: "PROG/P",
      objectName: "ZTEST",
    });
    expect(whereUsed.structuredContent).toMatchObject({
      count: 1,
      references: [{ name: "ZCALLER" }],
    });
    expect(reader.readSource).toHaveBeenCalledTimes(1);
  });
});
