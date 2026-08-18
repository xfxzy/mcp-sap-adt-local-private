import { describe, expect, it } from "vitest";
import { parseSystemsConfig } from "../../src/config/schema.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";

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
      tls: { mode: "strict" },
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

describe("SystemRegistry", () => {
  it("requires explicit activation before network tools", () => {
    const registry = new SystemRegistry(config);
    expect(() => registry.requireActive("SAH")).toThrow(/not active/i);
    registry.setActive(["SAH"]);
    expect(registry.requireActive("SAH").id).toBe("SAH");
  });

  it("rejects unconfigured systems atomically", () => {
    const registry = new SystemRegistry(config);
    expect(() => registry.setActive(["SAH", "UNKNOWN"])).toThrow(/configured/i);
    expect(registry.activeIds()).toEqual([]);
  });
});
