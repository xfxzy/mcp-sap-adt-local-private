import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import type { SapSystemConfig } from "../../src/config/types.js";
import type { CredentialStore } from "../../src/credentials/credential-store.js";
import { AdtProgramReader } from "../../src/development/program-reader.js";
import { inspectCertificate } from "../../src/tls/certificate.js";

const servers: ReturnType<typeof createServer>[] = [];

async function startServer(
  respond: (url: URL, response: ServerResponse) => void,
): Promise<{ port: number; system: SapSystemConfig }> {
  const pfx = await readFile(
    new URL("../fixtures/tls/expired-localhost.pfx", import.meta.url),
  );
  const server = createServer({ pfx, passphrase: "fixture-only" }, (req, res) =>
    respond(new URL(req.url ?? "/", "https://localhost"), res),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Program fixture did not bind");
  }
  const baseSystem: SapSystemConfig = {
    id: "FIXTURE",
    label: "Program fixture",
    kind: "fixture",
    environment: "non-production",
    connection: {
      protocol: "https",
      host: "localhost",
      port: address.port,
      client: "400",
      language: "1",
      serverTimezone: "UTC",
    },
    auth: {
      type: "basic",
      username: "fixture",
      credentialRef: "FIXTURE",
    },
    tls: { mode: "insecure" },
    access: {
      read: true,
      adtDevelopmentWrite: true,
      businessApiWrite: false,
    },
    development: { objectNamePatterns: ["Z*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 5_000,
      rateLimitPerMin: 600,
      maxSourceLines: 5_000,
    },
  };
  const observed = await inspectCertificate(baseSystem);
  return {
    port: address.port,
    system: {
      ...baseSystem,
      tls: {
        mode: "pinned",
        fingerprintSha256: observed.fingerprintSha256,
        allowExpired: true,
      },
    },
  };
}

function credentials(): CredentialStore {
  return { get: async () => "fixture-password" } as CredentialStore;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("ADT program reader", () => {
  it("reads active source and program metadata through the real adapter", async () => {
    const fixture = await startServer((url, response) => {
      if (url.pathname.endsWith("/source/main")) {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("REPORT ztest.\nWRITE / 'OK'.");
        return;
      }
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(
        '<?xml version="1.0" encoding="UTF-8"?><program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST" adtcore:description="Test program"><adtcore:packageRef adtcore:name="ZLOCAL"/></program:abapProgram>',
      );
    });

    const result = await new AdtProgramReader(credentials()).read(
      fixture.system,
      "ZTEST",
    );

    expect(result).toEqual({
      exists: true,
      active: true,
      source: "REPORT ztest.\nWRITE / 'OK'.",
      packageName: "ZLOCAL",
      description: "Test program",
    });
  });

  it("reports an absent program when SAP returns 404", async () => {
    const fixture = await startServer((_url, response) => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
    });

    await expect(
      new AdtProgramReader(credentials()).read(fixture.system, "ZR_MISSING"),
    ).resolves.toEqual({ exists: false, active: false });
  });
});
