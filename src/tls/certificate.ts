import { readFile } from "node:fs/promises";
import {
  checkServerIdentity,
  connect,
  type DetailedPeerCertificate,
  type PeerCertificate,
} from "node:tls";
import type { SapSystemConfig } from "../config/types.js";

export interface ObservedCertificate {
  hostnameMatches: boolean;
  expired: boolean;
  notYetValid?: boolean;
  fingerprintSha256: string;
  trusted?: boolean;
  authorizationError?: string;
  validFrom?: string;
  validTo?: string;
}

export function normalizeFingerprint(value: string): string {
  return value.replaceAll(":", "").trim().toUpperCase();
}

export function observePeerCertificate(
  hostname: string,
  certificate: PeerCertificate | DetailedPeerCertificate,
  trusted?: boolean,
  authorizationError?: string | Error | null,
): ObservedCertificate {
  const now = Date.now();
  const validFrom = Date.parse(certificate.valid_from);
  const validTo = Date.parse(certificate.valid_to);
  return {
    hostnameMatches: checkServerIdentity(hostname, certificate) === undefined,
    expired: Number.isFinite(validTo) ? now > validTo : true,
    notYetValid: Number.isFinite(validFrom) ? now < validFrom : true,
    fingerprintSha256: certificate.fingerprint256 ?? "",
    trusted,
    authorizationError:
      authorizationError === null || authorizationError === undefined
        ? undefined
        : String(authorizationError),
    validFrom: certificate.valid_from,
    validTo: certificate.valid_to,
  };
}

export async function inspectCertificate(
  system: SapSystemConfig,
): Promise<ObservedCertificate> {
  const ca =
    system.tls.mode === "custom-ca"
      ? await readFile(system.tls.caFile)
      : undefined;
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: system.connection.host,
      port: system.connection.port,
      servername: system.connection.host,
      rejectUnauthorized: false,
      ca,
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TLS inspection timed out for system ${system.id}`));
    }, system.limits.requestTimeoutMs);

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      const certificate = socket.getPeerCertificate(true);
      if (!certificate || Object.keys(certificate).length === 0) {
        socket.destroy();
        reject(
          new Error(`SAP system ${system.id} did not present a certificate`),
        );
        return;
      }
      const observed = observePeerCertificate(
        system.connection.host,
        certificate,
        socket.authorized,
        socket.authorizationError,
      );
      socket.end();
      resolve(observed);
    });
  });
}
