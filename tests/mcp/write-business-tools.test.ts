import { afterEach, describe, expect, it } from "vitest";
import { BusinessApiRegistry } from "../../src/business-api/business-api-registry.js";
import { parseBusinessApis } from "../../src/business-api/schema.js";
import { parseSystemsConfig } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/server.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { registerBusinessWriteTools } from "../../src/tools/business/write-business-tools.js";
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
      access: { read: true, adtDevelopmentWrite: true, businessApiWrite: true },
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
              operations: ["read", "update"],
              mutableFields: ["ProductType"],
              immutableFields: ["Product"],
              sensitiveFields: [],
              verifyFields: ["Product", "ProductType"],
            },
          ],
        },
      ],
    },
  },
});

describe("business API write tools", () => {
  it("registers prepare, apply, and verify tools", async () => {
    const registry = new SystemRegistry(systems);
    registry.setActive(["SAH"]);
    const server = createMcpServer();
    registerBusinessWriteTools(server, {
      systems: registry,
      apis: new BusinessApiRegistry(apiConfig, registry),
      credentials: {} as never,
      plans: {} as never,
      audit: { write: async () => undefined },
    });
    const client = await startTestMcpServer({ server });
    clients.push(client);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "prepare_business_change",
        "apply_business_change",
        "verify_business_change",
      ]),
    );
  });
});
