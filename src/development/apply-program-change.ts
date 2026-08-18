import type { AuditLog } from "../audit/audit-log.js";
import type { ChangePlanStore } from "../change-plans/change-plan-store.js";
import type { SapSystemConfig } from "../config/types.js";
import { requireWriteAccess } from "../policy/access-policy.js";
import type { SystemRegistry } from "../systems/system-registry.js";
import type { TlsDecision } from "../tls/tls-policy.js";
import type {
  ProgramChangePlan,
  StoredProgramChangeRequest,
} from "./prepare-program-change.js";
import type { ProgramReader } from "./program-reader.js";
import { hashProgramSource, validateProgramName } from "./program-request.js";
import type { ProgramWriter } from "./program-writer.js";
import {
  type ProgramVerificationResult,
  verifyProgram,
} from "./verify-program.js";

export interface ApplyProgramChangeRequest {
  planId: string;
  approveWrite: boolean;
}

export interface AppliedProgramChange extends ProgramVerificationResult {
  planId: string;
  action: "create" | "update";
}

export interface ApplyProgramChangeDeps {
  registry: Pick<SystemRegistry, "requireActive">;
  plans: ChangePlanStore;
  reader: ProgramReader;
  writer: ProgramWriter;
  audit: Pick<AuditLog, "write">;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  verifyTimeoutMs?: number;
  verifyIntervalMs?: number;
}

export async function applyProgramChange(
  deps: ApplyProgramChangeDeps,
  input: ApplyProgramChangeRequest,
): Promise<AppliedProgramChange> {
  if (input.approveWrite !== true) {
    throw new Error("approveWrite must be true before applying a SAP change");
  }

  const plan = deps.plans.consume<StoredProgramChangeRequest>(
    input.planId,
  ) as ProgramChangePlan;
  if (plan.kind !== "development") {
    throw new Error(`Change plan ${plan.id} is not a development plan`);
  }

  const system = deps.registry.requireActive(plan.systemId);
  try {
    requireWriteAccess(
      system,
      "adt-development",
      configuredWriteDecision(system),
    );
    validatePlanBinding(plan, system);
    const current = await deps.reader.read(system, plan.request.programName);
    if (plan.request.action === "create") {
      if (current.exists) {
        throw new Error(
          `SAP program ${plan.request.programName} changed since prepare: it now exists`,
        );
      }
      await deps.writer.create(system, plan.request);
    } else {
      if (
        !current.exists ||
        !current.active ||
        current.source === undefined ||
        !current.packageName ||
        current.packageName.toUpperCase() !== plan.request.packageName ||
        hashProgramSource(current.source) !== plan.expectedHash
      ) {
        throw new Error(
          `SAP program ${plan.request.programName} changed since prepare`,
        );
      }
      await deps.writer.update(system, plan.request);
    }

    const verified = await pollForVerification(deps, plan);
    await deps.audit.write({
      event: "adt_program_change",
      status: "success",
      planId: plan.id,
      systemId: plan.systemId,
      sapUser: plan.sapUser,
      action: plan.request.action,
      programName: plan.request.programName,
      packageName: plan.request.packageName,
      transportRequest: plan.request.transportRequest,
      sourceHash: plan.request.sourceHash,
    });
    return {
      ...verified,
      planId: plan.id,
      action: plan.request.action,
    };
  } catch (error) {
    await deps.audit.write({
      event: "adt_program_change",
      status: "failed",
      planId: plan.id,
      systemId: plan.systemId,
      sapUser: plan.sapUser,
      action: plan.request.action,
      programName: plan.request.programName,
      packageName: plan.request.packageName,
      transportRequest: plan.request.transportRequest,
      sourceHash: plan.request.sourceHash,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function validatePlanBinding(
  plan: ProgramChangePlan,
  system: SapSystemConfig,
): void {
  if (plan.sapUser !== system.auth.username) {
    throw new Error(`SAP user changed since plan ${plan.id} was prepared`);
  }
  const programName = validateProgramName(
    plan.request.programName,
    system.development.objectNamePatterns,
  );
  if (programName !== plan.target) {
    throw new Error(`Change plan ${plan.id} target binding is invalid`);
  }
  if (hashProgramSource(plan.request.source) !== plan.request.sourceHash) {
    throw new Error(`Change plan ${plan.id} source binding is invalid`);
  }
  if (system.development.requireTransport && !plan.request.transportRequest) {
    throw new Error(`Change plan ${plan.id} has no required transport request`);
  }
}

async function pollForVerification(
  deps: ApplyProgramChangeDeps,
  plan: ProgramChangePlan,
): Promise<ProgramVerificationResult> {
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now().getTime() + (deps.verifyTimeoutMs ?? 30_000);
  let lastError: unknown;

  do {
    try {
      return await verifyProgram(
        { registry: deps.registry, reader: deps.reader },
        {
          systemId: plan.systemId,
          programName: plan.request.programName,
          packageName: plan.request.packageName,
          expectedHash: plan.request.sourceHash,
        },
      );
    } catch (error) {
      lastError = error;
    }
    if (now().getTime() >= deadline) break;
    await sleep(deps.verifyIntervalMs ?? 500);
  } while (now().getTime() <= deadline);

  throw new Error(
    `Program verification failed after write: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
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
