import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SapSystemConfig } from "../../src/config/types.js";
import type { CredentialStore } from "../../src/credentials/credential-store.js";
import { RateLimiter } from "../../src/http/rate-limiter.js";
import { AdtSystemHealthProbe } from "../../src/tools/read/system-tools.js";

const servers: ReturnType<typeof createServer>[] = [];

async function startHealthFixture(): Promise<{
  port: number;
  paths: string[];
}> {
  const pfx = await readFile(
    new URL("../fixtures/tls/expired-localhost.pfx", import.meta.url),
  );
  const paths: string[] = [];
  const server = createServer(
    { pfx, passphrase: "fixture-only" },
    (request, response) => {
      const url = new URL(request.url ?? "/", "https://localhost");
      paths.push(url.pathname);
      if (request.headers.authorization !== "Basic Zml4dHVyZTpzZWNyZXQ=") {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      if (url.pathname === "/sap/bc/adt/discovery") {
        response.writeHead(200, { "content-type": "application/atomsvc+xml" });
        response.end(
          '<?xml version="1.0"?><service><workspace><collection href="/sap/bc/adt/repository" /></workspace></service>',
        );
        return;
      }
      if (url.pathname === "/sap/bc/adt/core/http/systeminformation") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            systemID: "FIX",
            userName: "fixture",
            client: "400",
            language: "EN",
          }),
        );
        return;
      }
      response.writeHead(404);
      response.end("not found");
    },
  );
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { port: address.port, paths };
}

async function startOnPremiseHealthFixture(): Promise<{
  port: number;
  paths: string[];
}> {
  const pfx = await readFile(
    new URL("../fixtures/tls/expired-localhost.pfx", import.meta.url),
  );
  const paths: string[] = [];
  const server = createServer(
    { pfx, passphrase: "fixture-only" },
    (request, response) => {
      const url = new URL(request.url ?? "/", "https://localhost");
      paths.push(url.pathname);
      if (url.pathname === "/sap/bc/adt/discovery") {
        response.writeHead(200, { "content-type": "application/atomsvc+xml" });
        response.end(
          '<?xml version="1.0"?><service><workspace><collection href="/sap/bc/adt/repository" /></workspace></service>',
        );
        return;
      }
      if (url.pathname === "/sap/bc/adt/core/http/systeminformation") {
        response.writeHead(404);
        response.end("not available on premise");
        return;
      }
      if (url.pathname === "/sap/bc/adt/core/discovery") {
        response.writeHead(200, { "content-type": "application/atomsvc+xml" });
        response.end('<?xml version="1.0"?><service><workspace /></service>');
        return;
      }
      response.writeHead(404);
      response.end("not found");
    },
  );
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { port: address.port, paths };
}

function fixtureSystem(port: number): SapSystemConfig {
  return {
    id: "FIXTURE",
    label: "Health fixture",
    kind: "fixture",
    environment: "non-production",
    connection: {
      protocol: "https",
      host: "localhost",
      port,
      client: "400",
      language: "1",
      serverTimezone: "UTC",
    },
    auth: { type: "basic", username: "fixture", credentialRef: "FIXTURE" },
    tls: { mode: "insecure" },
    access: {
      read: true,
      adtDevelopmentWrite: false,
      businessApiWrite: false,
    },
    development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 5000,
      rateLimitPerMin: 100,
      maxSourceLines: 5000,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("ADT system health probe", () => {
  it("parses both health resources and reuses one limiter per system", async () => {
    const fixture = await startHealthFixture();
    const credentials = {
      get: vi.fn(async () => "secret"),
    } as unknown as CredentialStore;
    const limiter = new RateLimiter(100);
    const acquire = vi.spyOn(limiter, "acquire");
    const createLimiter = vi.fn(() => limiter);
    const probe = new AdtSystemHealthProbe(credentials, createLimiter);
    const system = fixtureSystem(fixture.port);

    const first = await probe.inspect(system);
    const second = await probe.inspect(system);

    expect(first).toMatchObject({
      reachable: true,
      discoveryEndpointCount: 1,
      system: { systemID: "FIX", userName: "fixture", client: "400" },
    });
    expect(second.reachable).toBe(true);
    expect(fixture.paths).toEqual([
      "/sap/bc/adt/discovery",
      "/sap/bc/adt/core/http/systeminformation",
      "/sap/bc/adt/discovery",
      "/sap/bc/adt/core/http/systeminformation",
    ]);
    expect(createLimiter).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(4);
  });

  it("falls back explicitly when on-premise system information is unavailable", async () => {
    const fixture = await startOnPremiseHealthFixture();
    const credentials = {
      get: vi.fn(async () => "secret"),
    } as unknown as CredentialStore;
    const probe = new AdtSystemHealthProbe(credentials);
    const system = fixtureSystem(fixture.port);

    await expect(probe.inspect(system)).resolves.toMatchObject({
      reachable: true,
      systemInformationAvailable: false,
      system: {
        userName: "fixture",
        client: "400",
        language: "1",
      },
    });
    expect(fixture.paths).toEqual([
      "/sap/bc/adt/discovery",
      "/sap/bc/adt/core/http/systeminformation",
      "/sap/bc/adt/core/discovery",
    ]);
  });
});
