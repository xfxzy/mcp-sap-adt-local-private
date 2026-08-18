import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { request } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import type { SapSystemConfig } from "../../src/config/types.js";
import { inspectCertificate } from "../../src/tls/certificate.js";
import { createSapDispatcher } from "../../src/tls/create-dispatcher.js";

const servers: ReturnType<typeof createServer>[] = [];

function system(port: number): SapSystemConfig {
  return {
    id: "TLS",
    label: "TLS fixture",
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
    auth: { type: "basic", username: "fixture", credentialRef: "TLS" },
    tls: { mode: "insecure" },
    access: {
      read: true,
      adtDevelopmentWrite: false,
      businessApiWrite: false,
    },
    development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 30000,
      rateLimitPerMin: 60,
      maxSourceLines: 5000,
    },
  };
}

async function startExpiredServer(forceConnectionClose = false): Promise<{
  port: number;
  sessionReuse: boolean[];
}> {
  const pfx = await readFile(
    new URL("../fixtures/tls/expired-localhost.pfx", import.meta.url),
  );
  const server = createServer(
    {
      pfx,
      passphrase: "fixture-only",
      ...(forceConnectionClose ? { maxVersion: "TLSv1.2" as const } : {}),
    },
    (_req, res) => {
      if (forceConnectionClose) {
        res.setHeader("connection", "close");
        setTimeout(() => res.end("ok"), 50);
        return;
      }
      res.end("ok");
    },
  );
  const sessionReuse: boolean[] = [];
  server.on("secureConnection", (socket) => {
    sessionReuse.push(socket.isSessionReused());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("TLS fixture did not bind");
  }
  return { port: address.port, sessionReuse };
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

describe("TLS dispatchers", () => {
  it("rejects strict expired certificates and accepts exact expired pins", async () => {
    const { port } = await startExpiredServer();
    const fixtureSystem = system(port);
    const observed = await inspectCertificate(fixtureSystem);

    const strictDispatcher = createSapDispatcher({
      ...fixtureSystem,
      tls: { mode: "strict" },
    });
    await expect(
      request(`https://localhost:${port}/`, { dispatcher: strictDispatcher }),
    ).rejects.toThrow();
    await strictDispatcher.close();

    const pinnedDispatcher = createSapDispatcher({
      ...fixtureSystem,
      tls: {
        mode: "pinned",
        fingerprintSha256: observed.fingerprintSha256,
        allowExpired: true,
      },
    });
    const response = await request(`https://localhost:${port}/`, {
      dispatcher: pinnedDispatcher,
    });
    expect(response.statusCode).toBe(200);
    await response.body.text();
    await pinnedDispatcher.close();
  });

  it("rejects a changed pinned fingerprint", async () => {
    const { port } = await startExpiredServer();
    const fixtureSystem = system(port);
    const dispatcher = createSapDispatcher({
      ...fixtureSystem,
      tls: {
        mode: "pinned",
        fingerprintSha256: "00".repeat(32),
        allowExpired: true,
      },
    });
    await expect(
      request(`https://localhost:${port}/`, { dispatcher }),
    ).rejects.toThrow(/fingerprint/i);
    await dispatcher.close();
  });

  it("rejects an exact pin when the certificate hostname does not match", async () => {
    const { port } = await startExpiredServer();
    const fixtureSystem = system(port);
    const observed = await inspectCertificate(fixtureSystem);
    const mismatchedSystem: SapSystemConfig = {
      ...fixtureSystem,
      connection: { ...fixtureSystem.connection, host: "127.0.0.1" },
      tls: {
        mode: "pinned",
        fingerprintSha256: observed.fingerprintSha256,
        allowExpired: true,
      },
    };
    const dispatcher = createSapDispatcher(mismatchedSystem);

    await expect(
      request(`https://127.0.0.1:${port}/`, { dispatcher }),
    ).rejects.toThrow(/hostname/i);
    await dispatcher.close();
  });

  it("accepts repeated pinned requests across forced TLS reconnections", async () => {
    const { port, sessionReuse } = await startExpiredServer(true);
    const fixtureSystem = system(port);
    const observed = await inspectCertificate(fixtureSystem);
    const dispatcher = createSapDispatcher({
      ...fixtureSystem,
      tls: {
        mode: "pinned",
        fingerprintSha256: observed.fingerprintSha256,
        allowExpired: true,
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(`https://localhost:${port}/`, {
        dispatcher,
      });
      expect(response.statusCode).toBe(200);
      await response.body.text();
    }

    expect(sessionReuse).toEqual([false, false, false]);
    await dispatcher.close();
  });
});
