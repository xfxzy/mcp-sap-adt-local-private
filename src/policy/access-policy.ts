import type { SapSystemConfig } from "../config/types.js";
import type { TlsDecision } from "../tls/tls-policy.js";

export type WriteKind = "adt-development" | "business-api";

export function requireReadAccess(system: SapSystemConfig): void {
  if (!system.access.read) {
    throw new Error(`Read access is disabled for SAP system ${system.id}`);
  }
}

export function requireWriteAccess(
  system: SapSystemConfig,
  kind: WriteKind,
  tls: TlsDecision,
): void {
  requireReadAccess(system);
  if (system.environment === "production") {
    throw new Error(`Production SAP system ${system.id} is read-only`);
  }
  const enabled =
    kind === "adt-development"
      ? system.access.adtDevelopmentWrite
      : system.access.businessApiWrite;
  if (!enabled) {
    throw new Error(
      `${kind} write access is disabled for SAP system ${system.id}`,
    );
  }
  if (!tls.allowed || !tls.writeAllowed) {
    throw new Error(
      `TLS policy does not permit writes to SAP system ${system.id}${tls.reason ? `: ${tls.reason}` : ""}`,
    );
  }
}
