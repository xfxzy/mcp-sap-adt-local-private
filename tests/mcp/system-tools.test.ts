import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSystemsConfig } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import {
  registerSystemTools,
  type SystemHealthProbe,
} from "../../src/tools/read/system-tools.js";
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

async function setup(systemsConfig = config) {
  const registry = new SystemRegistry(systemsConfig);
  const probe: SystemHealthProbe = {
    inspect: vi.fn(async (system) => ({
      reachable: true as const,
      latencyMs: 12,
      discoveryEndpointCount: 4,
      systemInformationAvailable: true,
      system: {
        systemID: "S4H",
        userName: "DEMO_USER",
        client: system.connection.client,
        language: "EN",
      },
    })),
  };
  const server = createMcpServer();
  registerSystemTools(server, { registry, probe });
  const client = await startTestMcpServer({ server });
  clients.push(client);
  return { client, probe };
}

describe("system MCP tools", () => {
  it("registers all three system tools and lists without a network call", async () => {
    const { client, probe } = await setup();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual([
      "list_systems",
      "set_active_systems",
      "sap_system_info",
    ]);
    const result = await client.callTool("list_systems");
    expect(result.structuredContent).toMatchObject({ count: 1 });
    expect(probe.inspect).not.toHaveBeenCalled();
  });

  it("rejects health checks until the system is active", async () => {
    const { client, probe } = await setup();
    const result = await client.callTool("sap_system_info", {
      systemId: "SAH",
    });
    expect(result.isError).toBe(true);
    expect(probe.inspect).not.toHaveBeenCalled();
  });

  it("rejects health checks when read access is disabled", async () => {
    const blockedSystem = {
      ...config.systems[0],
      id: "BLOCKED",
      access: {
        ...config.systems[0].access,
        read: false,
      },
    };
    const { client, probe } = await setup({
      version: 1,
      systems: [blockedSystem],
    });
    await client.callTool("set_active_systems", { systemIds: ["BLOCKED"] });
    const result = await client.callTool("sap_system_info", {
      systemId: "BLOCKED",
    });
    expect(result.isError).toBe(true);
    expect(probe.inspect).not.toHaveBeenCalled();
  });

  it("activates a configured system and returns parsed health information", async () => {
    const { client } = await setup();
    await client.callTool("set_active_systems", { systemIds: ["sah"] });
    const result = await client.callTool("sap_system_info", {
      systemId: "SAH",
    });
    expect(result.structuredContent).toMatchObject({
      reachable: true,
      systemId: "SAH",
      latencyMs: 12,
    });
  });
});
