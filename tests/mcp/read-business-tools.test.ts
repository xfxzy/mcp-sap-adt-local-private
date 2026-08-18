import { afterEach, describe, expect, it } from "vitest";
import { BusinessApiRegistry } from "../../src/business-api/business-api-registry.js";
import { parseBusinessApis } from "../../src/business-api/schema.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { registerBusinessReadTools } from "../../src/tools/business/read-business-tools.js";
import { startTestMcpServer, type TestMcpClient } from "../helpers/mcp.js";

const clients: TestMcpClient[] = [];
afterEach(async () =>
  Promise.all(clients.splice(0).map((client) => client.close())),
);

const systems = parseSystemsConfig({
  version: 1,
  systems: [
    {
      id: "SAH",
      label: "SAH",
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
      auth: { type: "basic", username: "fixture", credentialRef: "SAH" },
      tls: { mode: "strict" },
      access: {
        read: true,
        adtDevelopmentWrite: false,
        businessApiWrite: false,
      },
      development: { objectNamePatterns: ["Z*"], requireTransport: true },
      businessApis: { enabledProfiles: ["p"] },
      limits: {
        requestTimeoutMs: 1000,
        rateLimitPerMin: 60,
        maxSourceLines: 100,
      },
    },
  ],
});
const apiConfig = parseBusinessApis({
  version: 1,
  profiles: {
    p: {
      services: [
        {
          id: "API_PRODUCT",
          serviceRoot: "/sap/opu/odata/sap/API_PRODUCT_SRV/",
          entities: [
            {
              entitySet: "A_Product",
              keys: ["Product"],
              operations: ["read"],
              mutableFields: [],
              immutableFields: ["Product"],
              sensitiveFields: [],
              verifyFields: ["Product"],
            },
          ],
        },
      ],
    },
  },
});

describe("business API read tools", () => {
  it("lists only APIs enabled for the active system", async () => {
    const registry = new SystemRegistry(systems);
    registry.setActive(["SAH"]);
    const server = createMcpServer();
    registerBusinessReadTools(server, {
      systems: registry,
      apis: new BusinessApiRegistry(apiConfig, registry),
      credentials: { get: async () => "fixture" } as never,
    });
    const client = await startTestMcpServer({ server });
    clients.push(client);
    const result = await client.callTool("list_business_apis", {
      systemId: "SAH",
    });
    expect(result.structuredContent).toMatchObject({
      apis: [{ id: "API_PRODUCT" }],
    });
  });

  it("blocks an unconfigured entity before making a request", async () => {
    const registry = new SystemRegistry(systems);
    registry.setActive(["SAH"]);
    const server = createMcpServer();
    registerBusinessReadTools(server, {
      systems: registry,
      apis: new BusinessApiRegistry(apiConfig, registry),
      credentials: { get: async () => "fixture" } as never,
    });
    const client = await startTestMcpServer({ server });
    clients.push(client);
    const result = await client.callTool("read_business_entity", {
      systemId: "SAH",
      apiId: "API_PRODUCT",
      entitySet: "A_Secret",
      keys: { Product: "1" },
    });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string })?.text).toMatch(
      /not allowlisted/i,
    );
  });
});
