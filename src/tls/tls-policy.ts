import type { TlsConfig } from "../config/types.js";
import {
  normalizeFingerprint,
  type ObservedCertificate,
} from "./certificate.js";

export type TlsDecision = {
  allowed: boolean;
  writeAllowed: boolean;
  reason?: string;
};

function reject(reason: string): TlsDecision {
  return { allowed: false, writeAllowed: false, reason };
}

export function evaluateCertificate(
  policy: TlsConfig,
  observed: ObservedCertificate,
): TlsDecision {
  if (policy.mode === "insecure") {
    return {
      allowed: true,
      writeAllowed: false,
      reason: "Insecure TLS mode is read-only",
    };
  }

  if (!observed.hostnameMatches) {
    return reject("TLS certificate hostname mismatch");
  }
  if (observed.notYetValid) {
    return reject("TLS certificate is not yet valid");
  }

  if (policy.mode === "pinned") {
    if (
      normalizeFingerprint(policy.fingerprintSha256) !==
      normalizeFingerprint(observed.fingerprintSha256)
    ) {
      return reject("TLS certificate fingerprint mismatch");
    }
    if (observed.expired && !policy.allowExpired) {
      return reject("TLS certificate is expired");
    }
    return { allowed: true, writeAllowed: true };
  }

  if (observed.expired) {
    return reject("TLS certificate is expired");
  }
  if (observed.trusted === false) {
    return reject(
      observed.authorizationError
        ? `TLS certificate is not trusted: ${observed.authorizationError}`
        : "TLS certificate is not trusted",
    );
  }
  return { allowed: true, writeAllowed: true };
}
