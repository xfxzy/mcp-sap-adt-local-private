import { afterEach, describe, expect, it } from "vitest";
import type { AuditLog } from "../../src/audit/audit-log.js";
import { ChangePlanStore } from "../../src/change-plans/change-plan-store.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import type { ProgramReader } from "../../src/development/program-reader.js";
import type { ProgramWriter } from "../../src/development/program-writer.js";
import type { RuntimeContext } from "../../src/runtime/context.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { registerProgramTools } from "../../src/tools/development/program-tools.js";
import { indexByName, requiredKeys } from "../helpers/assertions.js";
import { startTestMcpServer, type TestMcpClient } from "../helpers/mcp.js";

const config = parseSystemsConfig({
  version: 1,
  systems: [
    {
      id: "SAH",
      label: "SAH Client 400",
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
      auth: { type: "basic", username: "TEST", credentialRef: "SAH" },
      tls: { mode: "strict" },
      access: {
        read: true,
        adtDevelopmentWrite: true,
        businessApiWrite: false,
      },
      development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
      businessApis: { enabledProfiles: [] },
      limits: {
        requestTimeoutMs: 30_000,
        rateLimitPerMin: 60,
        maxSourceLines: 5_000,
      },
    },
  ],
});

const clients: TestMcpClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function dependencies() {
  const registry = new SystemRegistry(config);
  registry.setActive(["SAH"]);
  const reader: ProgramReader = {
    read: async () => ({ exists: false, active: false }),
  };
  const writer: ProgramWriter = {
    create: async () => undefined,
    update: async () => undefined,
  };
  return {
    registry,
    reader,
    writer,
    plans: new ChangePlanStore(),
    audit: { write: async () => undefined } as AuditLog,
  };
}

describe("controlled program MCP tools", () => {
  it("requires explicit approval only on apply", async () => {
    const server = createMcpServer();
    registerProgramTools(server, dependencies());
    const client = await startTestMcpServer({ server });
    clients.push(client);

    const tools = indexByName((await client.listTools()).tools);
    expect(Object.keys(tools).sort()).toEqual(
      [
        "apply_z_program_change",
        "prepare_z_program_change",
        "verify_z_program",
      ].sort(),
    );
    expect(requiredKeys(tools.prepare_z_program_change)).not.toContain(
      "approveWrite",
    );
    expect(requiredKeys(tools.apply_z_program_change)).toContain(
      "approveWrite",
    );
    expect(requiredKeys(tools.verify_z_program)).toContain("programName");
    expect(tools.apply_z_program_change.inputSchema.properties).toEqual(
      expect.objectContaining({
        planId: expect.any(Object),
        approveWrite: expect.objectContaining({ const: true }),
      }),
    );
  });

  it("wires all three tools into a runtime-context server", async () => {
    const server = createMcpServer({
      config,
      credentialStore: {},
      audit: { write: async () => undefined },
      configPath: "fixture",
    } as unknown as RuntimeContext);
    const client = await startTestMcpServer({ server });
    clients.push(client);

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "prepare_z_program_change",
        "apply_z_program_change",
        "verify_z_program",
      ]),
    );
  });

  it("rejects apply without the literal approval value", async () => {
    const server = createMcpServer();
    registerProgramTools(server, dependencies());
    const client = await startTestMcpServer({ server });
    clients.push(client);

    const result = await client.callTool("apply_z_program_change", {
      planId: "plan-1",
      approveWrite: false,
    });
    expect(result.isError).toBe(true);
  });
});
