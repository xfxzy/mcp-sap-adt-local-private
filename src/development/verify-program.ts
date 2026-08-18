import { requireReadAccess } from "../policy/access-policy.js";
import type { SystemRegistry } from "../systems/system-registry.js";
import type { ProgramReader } from "./program-reader.js";
import { hashProgramSource, validateProgramName } from "./program-request.js";

export interface VerifyProgramRequest {
  systemId: string;
  programName: string;
  packageName: string;
  expectedHash?: string;
}

export interface ProgramVerificationResult {
  systemId: string;
  programName: string;
  packageName: string;
  active: true;
  sourceHash: string;
  expectedHash?: string;
  hashMatches?: boolean;
}

export interface VerifyProgramDeps {
  registry: Pick<SystemRegistry, "requireActive">;
  reader: ProgramReader;
}

export async function verifyProgram(
  deps: VerifyProgramDeps,
  input: VerifyProgramRequest,
): Promise<ProgramVerificationResult> {
  const system = deps.registry.requireActive(input.systemId);
  requireReadAccess(system);
  const programName = validateProgramName(
    input.programName,
    system.development.objectNamePatterns,
  );
  const packageName = input.packageName.trim().toUpperCase();
  if (!packageName || packageName !== input.packageName) {
    throw new Error("Package name must be an exact non-empty value");
  }

  const current = await deps.reader.read(system, programName);
  if (!current.exists || !current.active || current.source === undefined) {
    throw new Error(`SAP program ${programName} is not active`);
  }
  if (!current.packageName) {
    throw new Error(`SAP program ${programName} package metadata is missing`);
  }
  if (current.packageName.toUpperCase() !== packageName) {
    throw new Error(
      `SAP program ${programName} is in package ${current.packageName}, not ${packageName}`,
    );
  }

  const sourceHash = hashProgramSource(current.source);
  const expectedHash = input.expectedHash?.toLowerCase();
  if (expectedHash && sourceHash !== expectedHash) {
    throw new Error(`SAP program ${programName} source hash does not match`);
  }
  return {
    systemId: system.id,
    programName,
    packageName,
    active: true,
    sourceHash,
    ...(expectedHash ? { expectedHash, hashMatches: true } : {}),
  };
}
