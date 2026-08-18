import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SapSystemConfig } from "../../src/config/types.js";

const mocks = vi.hoisted(() => {
  const buildConnector = vi.fn(() => vi.fn());
  const agentOptions: unknown[] = [];
  class Agent {
    constructor(options: unknown) {
      agentOptions.push(options);
    }

    async close(): Promise<void> {}
  }
  return { Agent, agentOptions, buildConnector };
});

vi.mock("undici", () => ({
  Agent: mocks.Agent,
  buildConnector: mocks.buildConnector,
}));

import { createSapDispatcher } from "../../src/tls/create-dispatcher.js";

function pinnedSystem(): SapSystemConfig {
  return {
    id: "TLS",
    label: "TLS fixture",
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
    auth: { type: "basic", username: "fixture", credentialRef: "TLS" },
    tls: {
      mode: "pinned",
      fingerprintSha256: "00".repeat(32),
      allowExpired: true,
    },
    access: {
      read: true,
      adtDevelopmentWrite: false,
      businessApiWrite: false,
    },
    development: { objectNamePatterns: ["Z*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 30_000,
      rateLimitPerMin: 60,
      maxSourceLines: 5_000,
    },
  };
}

describe("SAP TLS dispatcher", () => {
  beforeEach(() => {
    mocks.agentOptions.length = 0;
    mocks.buildConnector.mockClear();
  });

  it("disables TLS session caching for exact certificate pinning", async () => {
    const dispatcher = createSapDispatcher(pinnedSystem());

    expect(mocks.buildConnector).toHaveBeenCalledWith({
      rejectUnauthorized: false,
      maxCachedSessions: 0,
    });
    await dispatcher.close();
  });
});
