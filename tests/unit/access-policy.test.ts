import { describe, expect, it } from "vitest";
import type { SapSystemConfig } from "../../src/config/types.js";
import {
  requireReadAccess,
  requireWriteAccess,
} from "../../src/policy/access-policy.js";

const system: SapSystemConfig = {
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
};

describe("access policy", () => {
  it("requires non-production, write flag, and trusted write TLS", () => {
    expect(() =>
      requireWriteAccess(system, "adt-development", {
        allowed: true,
        writeAllowed: false,
      }),
    ).toThrow(/TLS/i);
  });

  it("rejects every production write even if a config bypasses parsing", () => {
    expect(() =>
      requireWriteAccess(
        { ...system, environment: "production" },
        "business-api",
        { allowed: true, writeAllowed: true },
      ),
    ).toThrow(/production/i);
  });

  it("requires read access", () => {
    expect(() =>
      requireReadAccess({
        ...system,
        access: { ...system.access, read: false },
      }),
    ).toThrow(/read/i);
  });
});
