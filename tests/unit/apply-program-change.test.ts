import { describe, expect, it } from "vitest";
import type { AuditLog } from "../../src/audit/audit-log.js";
import { ChangePlanStore } from "../../src/change-plans/change-plan-store.js";
import type { SapSystemConfig } from "../../src/config/types.js";
import {
  type ApplyProgramChangeDeps,
  applyProgramChange,
} from "../../src/development/apply-program-change.js";
import type { ProgramSnapshot } from "../../src/development/program-reader.js";
import { hashProgramSource } from "../../src/development/program-request.js";
import type { ProgramWriter } from "../../src/development/program-writer.js";
import { verifyProgram } from "../../src/development/verify-program.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";

const oldSource = "REPORT zr_test.\nWRITE / 'OLD'.";
const newSource = "REPORT zr_test.\nWRITE / 'NEW'.";

function system(overrides: Partial<SapSystemConfig> = {}): SapSystemConfig {
  return {
    id: "SAH",
    label: "SAH Client 400",
    kind: "fixture",
    environment: "non-production",
    connection: {
      protocol: "https",
      host: "localhost",
      port: 443,
      client: "400",
      language: "1",
      serverTimezone: "UTC",
    },
    auth: { type: "basic", username: "TEST", credentialRef: "SAH" },
    tls: { mode: "strict" },
    access: {
      read: true,
      adtDevelopmentWrite: true,
      businessApiWrite: false,
    },
    development: { objectNamePatterns: ["Z*"], requireTransport: true },
    businessApis: { enabledProfiles: [] },
    limits: {
      requestTimeoutMs: 30_000,
      rateLimitPerMin: 60,
      maxSourceLines: 5_000,
    },
    ...overrides,
  };
}

function registry(config = system()): SystemRegistry {
  const value = new SystemRegistry({ version: 1, systems: [config] });
  value.setActive([config.id]);
  return value;
}

function addUpdatePlan(plans: ChangePlanStore): void {
  plans.put({
    id: "plan-1",
    kind: "development",
    systemId: "SAH",
    target: "ZR_TEST",
    createdAt: "2026-08-09T00:00:00Z",
    expiresAt: "2026-08-09T00:10:00Z",
    expectedHash: hashProgramSource(oldSource),
    currentHash: hashProgramSource(oldSource),
    sapUser: "TEST",
    request: {
      action: "update",
      programName: "ZR_TEST",
      packageName: "ZLOCAL",
      transportRequest: "S4HK900001",
      description: "Controlled update",
      source: newSource,
      sourceHash: hashProgramSource(newSource),
    },
    diff: "fixture diff",
  });
}

function fixtureDeps(snapshots: ProgramSnapshot[]): ApplyProgramChangeDeps & {
  writes: Array<{ action: string; programName: string }>;
  audits: Record<string, unknown>[];
} {
  const writes: Array<{ action: string; programName: string }> = [];
  const audits: Record<string, unknown>[] = [];
  const writer: ProgramWriter = {
    create: async (_system, request) => {
      writes.push({ action: "create", programName: request.programName });
    },
    update: async (_system, request) => {
      writes.push({ action: "update", programName: request.programName });
    },
  };
  return {
    registry: registry(),
    plans: new ChangePlanStore(() => new Date("2026-08-09T00:05:00Z")),
    reader: {
      read: async () => snapshots.shift() ?? { exists: false, active: false },
    },
    writer,
    audit: { write: async (event) => audits.push(event) } as AuditLog,
    verifyTimeoutMs: 0,
    writes,
    audits,
  };
}

describe("applyProgramChange", () => {
  it("refuses an update when SAP changed after prepare and consumes the plan", async () => {
    const deps = fixtureDeps([
      {
        exists: true,
        active: true,
        source: "REPORT zr_test.\nWRITE / 'OTHER'.",
        packageName: "ZLOCAL",
      },
    ]);
    addUpdatePlan(deps.plans);

    await expect(
      applyProgramChange(deps, { planId: "plan-1", approveWrite: true }),
    ).rejects.toThrow(/changed since prepare/i);
    expect(deps.writes).toHaveLength(0);
    expect(() => deps.plans.get("plan-1")).toThrow(/not found|consumed/i);
  });

  it("refuses an update before writing when the SAP package changed", async () => {
    const deps = fixtureDeps([
      {
        exists: true,
        active: true,
        source: oldSource,
        packageName: "ZOTHER",
      },
    ]);
    addUpdatePlan(deps.plans);

    await expect(
      applyProgramChange(deps, { planId: "plan-1", approveWrite: true }),
    ).rejects.toThrow(/package|changed since prepare/i);
    expect(deps.writes).toHaveLength(0);
  });

  it("applies, activates, verifies, audits, and consumes a plan exactly once", async () => {
    const deps = fixtureDeps([
      {
        exists: true,
        active: true,
        source: oldSource,
        packageName: "ZLOCAL",
      },
      {
        exists: true,
        active: true,
        source: newSource.replaceAll("\n", "\r\n"),
        packageName: "ZLOCAL",
      },
    ]);
    addUpdatePlan(deps.plans);

    const result = await applyProgramChange(deps, {
      planId: "plan-1",
      approveWrite: true,
    });

    expect(result).toMatchObject({
      planId: "plan-1",
      action: "update",
      programName: "ZR_TEST",
      active: true,
      sourceHash: hashProgramSource(newSource),
    });
    expect(deps.writes).toEqual([{ action: "update", programName: "ZR_TEST" }]);
    expect(deps.audits.at(-1)).toMatchObject({
      event: "adt_program_change",
      status: "success",
      planId: "plan-1",
    });
    await expect(
      applyProgramChange(deps, { planId: "plan-1", approveWrite: true }),
    ).rejects.toThrow(/not found|consumed/i);
  });

  it("does not consume or write when explicit approval is false", async () => {
    const deps = fixtureDeps([]);
    addUpdatePlan(deps.plans);

    await expect(
      applyProgramChange(deps, { planId: "plan-1", approveWrite: false }),
    ).rejects.toThrow(/approveWrite/i);
    expect(deps.plans.get("plan-1").id).toBe("plan-1");
    expect(deps.writes).toHaveLength(0);
  });
});

describe("verifyProgram", () => {
  it("requires an active program in the expected package with the expected hash", async () => {
    const result = await verifyProgram(
      {
        registry: registry(),
        reader: {
          read: async () => ({
            exists: true,
            active: true,
            source: newSource,
            packageName: "ZLOCAL",
          }),
        },
      },
      {
        systemId: "SAH",
        programName: "ZR_TEST",
        packageName: "ZLOCAL",
        expectedHash: hashProgramSource(newSource),
      },
    );

    expect(result).toMatchObject({
      active: true,
      packageName: "ZLOCAL",
      sourceHash: hashProgramSource(newSource),
      hashMatches: true,
    });
  });
});
