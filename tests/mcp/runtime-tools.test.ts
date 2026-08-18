import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeReader } from "../../src/adt/runtime-reader.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import {
  RUNTIME_TOOL_NAMES,
  registerRuntimeTools,
} from "../../src/tools/read/runtime-tools.js";
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

function runtimeReader(): RuntimeReader {
  return {
    listDumps: vi.fn(async () => ({
      items: [
        {
          id: "DUMP-1",
          title: "TIME_OUT",
          updatedAt: "2026-08-09T20:30:45",
          uri: "/sap/bc/adt/runtime/dump/DUMP-1",
          summary: "Runtime exceeded",
        },
      ],
    })),
    readDumpDetail: vi.fn(async (_system, params) => ({
      dumpId: params.dumpId,
      view: params.view,
      content: "Formatted dump",
    })),
    readSystemMessages: vi.fn(async () => ({ items: [] })),
    readHttpLog: vi.fn(async () => ({
      items: [
        {
          type: "Backend Error",
          shortText: "HTTP 500",
          transactionId: "ABC123",
          occurredAt: "2026-08-09T20:30:45",
        },
      ],
    })),
    listTransports: vi.fn(async () => ({
      items: [
        {
          number: "SAHK900001",
          description: "Fixture request",
          owner: "DEMO_USER",
          status: "D",
        },
      ],
    })),
  };
}

async function setup(reader = runtimeReader()) {
  const registry = new SystemRegistry(config);
  registry.setActive(["SAH"]);
  const server = createMcpServer();
  registerRuntimeTools(server, { registry, reader });
  const client = await startTestMcpServer({ server });
  clients.push(client);
  return { client, reader };
}

describe("runtime MCP tools", () => {
  it("registers all five runtime tools", async () => {
    const { client } = await setup();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      ...RUNTIME_TOOL_NAMES,
    ]);
  });

  it("wires runtime tools into a runtime-context server", async () => {
    const server = createMcpServer({
      config,
      credentialStore: {},
      audit: {},
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const client = await startTestMcpServer({ server });
    clients.push(client);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...RUNTIME_TOOL_NAMES]));
  });

  it("lists dumps, reads detail, messages, HTTP log, and transports", async () => {
    const { client, reader } = await setup();
    const dumps = await client.callTool("list_dumps", {
      systemId: "SAH",
      user: "DEMO_USER",
      maxResults: 25,
    });
    expect(dumps.structuredContent).toMatchObject({
      count: 1,
      items: [{ id: "DUMP-1" }],
    });
    expect(reader.listDumps).toHaveBeenCalledWith(expect.anything(), {
      user: "DEMO_USER",
      maxResults: 25,
    });

    const detail = await client.callTool("read_dump_detail", {
      systemId: "SAH",
      dumpId: "DUMP-1",
      view: "formatted",
    });
    expect(detail.structuredContent).toMatchObject({
      dumpId: "DUMP-1",
      view: "formatted",
      content: "Formatted dump",
    });

    const messages = await client.callTool("read_system_messages", {
      systemId: "SAH",
      maxResults: 10,
    });
    expect(messages.structuredContent).toEqual({
      systemId: "SAH",
      count: 0,
      items: [],
    });

    const httpLog = await client.callTool("read_http_log", {
      systemId: "SAH",
      maxResults: 10,
    });
    expect(httpLog.structuredContent).toMatchObject({
      count: 1,
      items: [{ transactionId: "ABC123" }],
    });

    const transports = await client.callTool("list_transports", {
      systemId: "SAH",
      status: "D",
    });
    expect(transports.structuredContent).toMatchObject({
      count: 1,
      items: [{ number: "SAHK900001" }],
    });
    expect(reader.listTransports).toHaveBeenCalledWith(expect.anything(), {
      user: "DEMO_USER",
      status: "D",
    });
  });

  it("returns the empty feed shape consistently", async () => {
    const reader = runtimeReader();
    vi.mocked(reader.listDumps).mockResolvedValue({ items: [] });
    vi.mocked(reader.readHttpLog).mockResolvedValue({ items: [] });
    vi.mocked(reader.listTransports).mockResolvedValue({ items: [] });
    const { client } = await setup(reader);

    for (const tool of ["list_dumps", "read_http_log", "list_transports"]) {
      const response = await client.callTool(tool, { systemId: "SAH" });
      expect(response.structuredContent).toMatchObject({ count: 0, items: [] });
    }
  });
});
