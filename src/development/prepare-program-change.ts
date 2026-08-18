import { randomUUID } from "node:crypto";
import type {
  ChangePlan,
  ChangePlanStore,
} from "../change-plans/change-plan-store.js";
import type { SapSystemConfig } from "../config/types.js";
import { requireWriteAccess } from "../policy/access-policy.js";
import type { SystemRegistry } from "../systems/system-registry.js";
import type { TlsDecision } from "../tls/tls-policy.js";
import type { ProgramReader } from "./program-reader.js";
import { hashProgramSource, validateProgramName } from "./program-request.js";
import { readLocalProgramSource } from "./source-file.js";

const PLAN_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_PROGRAM_SOURCE_BYTES = 200_000;

export type ProgramChangeAction = "create" | "update";

export interface PrepareProgramChangeRequest {
  systemId: string;
  action: ProgramChangeAction;
  programName: string;
  sourcePath: string;
  packageName: string;
  transportRequest?: string;
  description: string;
}

export interface StoredProgramChangeRequest {
  action: ProgramChangeAction;
  programName: string;
  packageName: string;
  transportRequest?: string;
  description: string;
  source: string;
  sourceHash: string;
}

export interface ProgramChangePlan
  extends ChangePlan<StoredProgramChangeRequest> {
  sapUser: string;
  diff: string;
  currentHash?: string;
}

export interface PreparedProgramChange {
  id: string;
  kind: "development";
  systemId: string;
  target: string;
  createdAt: string;
  expiresAt: string;
  sapUser: string;
  expectedHash?: string;
  currentHash?: string;
  request: Omit<StoredProgramChangeRequest, "source">;
  diff: string;
}

export interface PrepareProgramChangeDeps {
  registry: Pick<SystemRegistry, "requireActive">;
  reader: ProgramReader;
  plans: ChangePlanStore;
  now?: () => Date;
  newPlanId?: () => string;
}

export async function prepareProgramChange(
  deps: PrepareProgramChangeDeps,
  input: PrepareProgramChangeRequest,
): Promise<PreparedProgramChange> {
  const system = deps.registry.requireActive(input.systemId);
  requireWriteAccess(
    system,
    "adt-development",
    configuredWriteDecision(system),
  );

  const programName = validateProgramName(
    input.programName,
    system.development.objectNamePatterns,
  );
  const packageName = requiredValue(
    input.packageName,
    "Package name",
  ).toUpperCase();
  const description = requiredValue(input.description, "Description");
  const transportRequest = optionalValue(input.transportRequest)?.toUpperCase();
  if (system.development.requireTransport && !transportRequest) {
    throw new Error(
      `Transport request is required for SAP system ${system.id}`,
    );
  }

  const local = readLocalProgramSource(
    programName,
    input.sourcePath,
    MAX_PROGRAM_SOURCE_BYTES,
  );
  if (local.lineCount > system.limits.maxSourceLines) {
    throw new Error(
      `Source exceeds the ${system.limits.maxSourceLines}-line limit`,
    );
  }

  const current = await deps.reader.read(system, programName);
  if (input.action === "create" && current.exists) {
    throw new Error(`SAP program ${programName} already exists`);
  }
  if (
    input.action === "update" &&
    (!current.exists || !current.active || current.source === undefined)
  ) {
    throw new Error(
      `SAP program ${programName} must exist and be active for update`,
    );
  }
  if (
    input.action === "update" &&
    current.packageName &&
    current.packageName.toUpperCase() !== packageName
  ) {
    throw new Error(
      `SAP program ${programName} belongs to package ${current.packageName}, not ${packageName}`,
    );
  }

  const currentSource = current.source ?? "";
  const currentHash =
    input.action === "update" ? hashProgramSource(currentSource) : undefined;
  const now = (deps.now ?? (() => new Date()))();
  const storedRequest: StoredProgramChangeRequest = {
    action: input.action,
    programName,
    packageName,
    ...(transportRequest ? { transportRequest } : {}),
    description,
    source: local.source,
    sourceHash: local.sha256,
  };
  const plan: ProgramChangePlan = {
    id: (deps.newPlanId ?? randomUUID)(),
    kind: "development",
    systemId: system.id,
    target: programName,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_LIFETIME_MS).toISOString(),
    sapUser: system.auth.username,
    ...(currentHash ? { expectedHash: currentHash, currentHash } : {}),
    request: storedRequest,
    diff: unifiedSourceDiff(programName, currentSource, local.source),
  };
  deps.plans.put(plan);

  return {
    id: plan.id,
    kind: "development",
    systemId: plan.systemId,
    target: plan.target,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    sapUser: plan.sapUser,
    ...(plan.expectedHash ? { expectedHash: plan.expectedHash } : {}),
    ...(plan.currentHash ? { currentHash: plan.currentHash } : {}),
    request: {
      action: storedRequest.action,
      programName: storedRequest.programName,
      packageName: storedRequest.packageName,
      ...(storedRequest.transportRequest
        ? { transportRequest: storedRequest.transportRequest }
        : {}),
      description: storedRequest.description,
      sourceHash: storedRequest.sourceHash,
    },
    diff: plan.diff,
  };
}

function configuredWriteDecision(system: SapSystemConfig): TlsDecision {
  if (system.tls.mode === "insecure") {
    return {
      allowed: true,
      writeAllowed: false,
      reason: "Insecure TLS mode is read-only",
    };
  }
  return { allowed: true, writeAllowed: true };
}

function requiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new Error(`${label} must be an exact non-empty value`);
  }
  return normalized;
}

function optionalValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized !== value) return undefined;
  return normalized;
}

function unifiedSourceDiff(
  programName: string,
  before: string,
  after: string,
): string {
  const output = [`--- SAP/${programName}`, `+++ LOCAL/${programName}`];
  if (before) output.push(...before.split(/\r?\n/).map((line) => `-${line}`));
  if (after) output.push(...after.split(/\r?\n/).map((line) => `+${line}`));
  return output.join("\n");
}
