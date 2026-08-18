import { readFileSync } from "node:fs";
import type { TLSSocket } from "node:tls";
import { Agent, buildConnector, type Dispatcher } from "undici";
import type { SapSystemConfig } from "../config/types.js";
import { observePeerCertificate } from "./certificate.js";
import { evaluateCertificate } from "./tls-policy.js";

function createPinnedConnector(
  system: SapSystemConfig & {
    tls: Extract<SapSystemConfig["tls"], { mode: "pinned" }>;
  },
): ReturnType<typeof buildConnector> {
  const connect = buildConnector({
    rejectUnauthorized: false,
    maxCachedSessions: 0,
  });
  return (options, callback) => {
    connect(options, (error, socket) => {
      if (error || !socket) {
        callback(error ?? new Error("TLS connection failed"), null);
        return;
      }

      const tlsSocket = socket as TLSSocket;
      const certificate = tlsSocket.getPeerCertificate(true);
      if (!certificate || Object.keys(certificate).length === 0) {
        socket.destroy();
        callback(new Error("TLS peer did not present a certificate"), null);
        return;
      }
      const observed = observePeerCertificate(
        system.connection.host,
        certificate,
        tlsSocket.authorized,
        tlsSocket.authorizationError,
      );
      const decision = evaluateCertificate(system.tls, observed);
      if (!decision.allowed) {
        socket.destroy();
        callback(
          new Error(decision.reason ?? "TLS certificate rejected"),
          null,
        );
        return;
      }
      callback(null, socket);
    });
  };
}

export function createSapDispatcher(system: SapSystemConfig): Dispatcher {
  switch (system.tls.mode) {
    case "strict":
      return new Agent({ connect: { rejectUnauthorized: true } });
    case "custom-ca":
      return new Agent({
        connect: {
          rejectUnauthorized: true,
          ca: readFileSync(system.tls.caFile),
        },
      });
    case "pinned":
      return new Agent({
        connect: createPinnedConnector(
          system as SapSystemConfig & {
            tls: Extract<SapSystemConfig["tls"], { mode: "pinned" }>;
          },
        ),
      });
    case "insecure":
      return new Agent({ connect: { rejectUnauthorized: false } });
  }
}
