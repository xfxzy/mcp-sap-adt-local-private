import { describe, expect, it } from "vitest";
import { getSystem, parseSystemsConfig } from "../../src/config/schema.js";

const valid = {
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
        fingerprintSha256:
          "A0:A1:A2:A3:A4:A5:A6:A7:A8:A9:AA:AB:AC:AD:AE:AF:B0:B1:B2:B3:B4:B5:B6:B7:B8:B9:BA:BB:BC:BD:BE:BF",
        allowExpired: true,
      },
      access: {
        read: true,
        adtDevelopmentWrite: true,
        businessApiWrite: true,
      },
      development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
      businessApis: { enabledProfiles: ["s4-core-masterdata-approved"] },
      limits: {
        requestTimeoutMs: 30000,
        rateLimitPerMin: 60,
        maxSourceLines: 5000,
      },
    },
  ],
};

describe("systems configuration", () => {
  it("accepts a configured non-production write system", () => {
    expect(parseSystemsConfig(valid).systems[0].id).toBe("SAH");
  });

  it("normalizes system ids to uppercase for lookup", () => {
    const config = parseSystemsConfig({
      ...valid,
      systems: [{ ...valid.systems[0], id: "sah" }],
    });
    expect(getSystem(config, "sah").id).toBe("SAH");
  });

  it("rejects production write flags", () => {
    const input = structuredClone(valid);
    input.systems[0].environment = "production";
    expect(() => parseSystemsConfig(input)).toThrow(/production.*read-only/i);
  });

  it("rejects duplicate system ids", () => {
    expect(() =>
      parseSystemsConfig({
        ...valid,
        systems: [valid.systems[0], valid.systems[0]],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects insecure connection shapes", () => {
    const input = structuredClone(valid);
    input.systems[0].connection.protocol = "http";
    expect(() => parseSystemsConfig(input)).toThrow(/https/i);
  });
});
