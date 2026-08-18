import { afterEach, describe, expect, it } from "vitest";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { startTestMcpServer, type TestMcpClient } from "../helpers/mcp.js";

const clients: TestMcpClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("read tool inventory", () => {
  it("retains the exact 16 read-compatible tool names", async () => {
    const config = parseSystemsConfig({
      version: 1,
      systems: [
        {
          id: "FIXTURE",
          label: "Fixture",
          kind: "fixture",
          environment: "non-production",
          connection: {
            protocol: "https",
            host: "localhost",
            port: 443,
            client: "400",
            language: "1",
            serverTimezone: "UTC",
          },
          auth: {
            type: "basic",
            username: "fixture",
            credentialRef: "FIXTURE",
          },
          tls: { mode: "strict" },
          access: {
            read: true,
            adtDevelopmentWrite: false,
            businessApiWrite: false,
          },
          development: {
            objectNamePatterns: ["Z*", "Y*"],
            requireTransport: true,
          },
          businessApis: { enabledProfiles: [] },
          limits: {
            requestTimeoutMs: 30000,
            rateLimitPerMin: 60,
            maxSourceLines: 5000,
          },
        },
      ],
    });
    const server = createMcpServer({
      config,
      credentialStore: {},
      audit: {},
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const client = await startTestMcpServer({ server });
    clients.push(client);

    const toolNames = (await client.listTools()).tools.map((tool) => tool.name);
    const readToolNames = [
      "get_object_structure",
      "list_dumps",
      "list_systems",
      "list_transports",
      "read_dump_detail",
      "read_http_log",
      "read_source_code",
      "read_source_range",
      "read_system_messages",
      "read_table",
      "read_table_structure",
      "sap_system_info",
      "search_repository_object",
      "search_source",
      "set_active_systems",
      "where_used",
    ];
    expect(
      toolNames.filter((name) => readToolNames.includes(name)).sort(),
    ).toEqual(readToolNames.sort());
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        "delete_program",
        "delete_repository_object",
        "release_transport",
      ]),
    );
  });
});
