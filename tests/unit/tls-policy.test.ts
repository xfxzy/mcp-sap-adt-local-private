import { describe, expect, it } from "vitest";
import { evaluateCertificate } from "../../src/tls/tls-policy.js";

describe("TLS policy", () => {
  it("accepts an expired certificate only when host and fingerprint are pinned", () => {
    expect(
      evaluateCertificate(
        {
          mode: "pinned",
          allowExpired: true,
          fingerprintSha256: "AA:BB",
        },
        {
          hostnameMatches: true,
          expired: true,
          fingerprintSha256: "AA:BB",
        },
      ),
    ).toEqual({ allowed: true, writeAllowed: true });
  });

  it("rejects a changed pinned certificate", () => {
    expect(
      evaluateCertificate(
        {
          mode: "pinned",
          allowExpired: true,
          fingerprintSha256: "AA:BB",
        },
        {
          hostnameMatches: true,
          expired: true,
          fingerprintSha256: "CC:DD",
        },
      ).allowed,
    ).toBe(false);
  });

  it("marks insecure transport read-only", () => {
    expect(
      evaluateCertificate(
        { mode: "insecure" },
        {
          hostnameMatches: false,
          expired: true,
          fingerprintSha256: "CC:DD",
        },
      ).writeAllowed,
    ).toBe(false);
  });

  it("requires normal trust and validity in strict mode", () => {
    expect(
      evaluateCertificate(
        { mode: "strict" },
        {
          hostnameMatches: true,
          expired: false,
          fingerprintSha256: "AA:BB",
          trusted: false,
        },
      ).allowed,
    ).toBe(false);
  });
});
