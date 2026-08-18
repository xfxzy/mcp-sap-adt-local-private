import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChangePlanStore } from "../../src/change-plans/change-plan-store.js";
import type { SapSystemConfig } from "../../src/config/types.js";
import { prepareProgramChange } from "../../src/development/prepare-program-change.js";
import type {
  ProgramReader,
  ProgramSnapshot,
} from "../../src/development/program-reader.js";
import { SystemRegistry } from "../../src/systems/system-registry.js";
import { hash } from "../helpers/assertions.js";

const system: SapSystemConfig = {
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
  development: { objectNamePatterns: ["ZR_*"], requireTransport: true },
  businessApis: { enabledProfiles: [] },
  limits: {
    requestTimeoutMs: 30_000,
    rateLimitPerMin: 60,
    maxSourceLines: 5_000,
  },
};

function registry(): SystemRegistry {
  const value = new SystemRegistry({ version: 1, systems: [system] });
  value.setActive(["SAH"]);
  return value;
}

function reader(snapshot: ProgramSnapshot): ProgramReader {
  return { read: async () => snapshot };
}

async function withSource<T>(
  programName: string,
  source: string,
  run: (path: string) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "mcp-adt-prepare-"));
  const sourcePath = join(directory, `${programName}.abap`);
  writeFileSync(sourcePath, source, "utf8");
  try {
    return await run(sourcePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("prepareProgramChange", () => {
  it("binds an update plan to current and requested hashes", async () => {
    const current = "REPORT zr_test.\nWRITE / 'OLD'.";
    const requested = "REPORT zr_test.\nWRITE / 'NEW'.";
    const plans = new ChangePlanStore(() => new Date("2026-08-09T00:05:00Z"));

    await withSource("ZR_TEST", requested, async (sourcePath) => {
      const plan = await prepareProgramChange(
        {
          registry: registry(),
          reader: reader({
            exists: true,
            active: true,
            source: current,
            packageName: "ZLOCAL",
          }),
          plans,
          now: () => new Date("2026-08-09T00:00:00Z"),
          newPlanId: () => "plan-update",
        },
        {
          systemId: "SAH",
          action: "update",
          programName: "zr_test",
          sourcePath,
          packageName: "ZLOCAL",
          transportRequest: "S4HK900001",
          description: "Controlled update",
        },
      );

      expect(plan.expectedHash).toBe(hash(current));
      expect(plan.request.sourceHash).toBe(hash(requested));
      expect(plan.diff).toContain("-WRITE / 'OLD'.");
      expect(plan.diff).toContain("+WRITE / 'NEW'.");
      expect(plan.request).not.toHaveProperty("sourcePath");
      expect(plan).toMatchObject({ sapUser: "TEST" });
      expect(plans.get("plan-update")).toMatchObject({
        id: "plan-update",
        sapUser: "TEST",
      });
    });
  });

  it("prepares create only when the SAP object is absent", async () => {
    await withSource("ZR_NEW", "REPORT zr_new.", async (sourcePath) => {
      const plan = await prepareProgramChange(
        {
          registry: registry(),
          reader: reader({ exists: false, active: false }),
          plans: new ChangePlanStore(),
          newPlanId: () => "plan-create",
        },
        {
          systemId: "SAH",
          action: "create",
          programName: "ZR_NEW",
          sourcePath,
          packageName: "ZLOCAL",
          transportRequest: "S4HK900001",
          description: "Controlled create",
        },
      );

      expect(plan.id).toBe("plan-create");
      expect(plan.expectedHash).toBeUndefined();
      expect(plan.diff).toContain("+REPORT zr_new.");
    });
  });

  it("rejects create for an existing object and update without an active object", async () => {
    await withSource("ZR_TEST", "REPORT zr_test.", async (sourcePath) => {
      const baseRequest = {
        systemId: "SAH",
        programName: "ZR_TEST",
        sourcePath,
        packageName: "ZLOCAL",
        transportRequest: "S4HK900001",
        description: "Controlled change",
      } as const;

      await expect(
        prepareProgramChange(
          {
            registry: registry(),
            reader: reader({
              exists: true,
              active: true,
              source: "REPORT zr_test.",
              packageName: "ZLOCAL",
            }),
            plans: new ChangePlanStore(),
          },
          { ...baseRequest, action: "create" },
        ),
      ).rejects.toThrow(/already exists/i);

      await expect(
        prepareProgramChange(
          {
            registry: registry(),
            reader: reader({ exists: true, active: false }),
            plans: new ChangePlanStore(),
          },
          { ...baseRequest, action: "update" },
        ),
      ).rejects.toThrow(/active/i);
    });
  });

  it("requires configured names, package, and transport before any SAP read", async () => {
    let reads = 0;
    const countingReader: ProgramReader = {
      read: async () => {
        reads += 1;
        return { exists: false, active: false };
      },
    };

    await withSource("ZY_BAD", "REPORT zy_bad.", async (sourcePath) => {
      await expect(
        prepareProgramChange(
          {
            registry: registry(),
            reader: countingReader,
            plans: new ChangePlanStore(),
          },
          {
            systemId: "SAH",
            action: "create",
            programName: "ZY_BAD",
            sourcePath,
            packageName: "ZLOCAL",
            transportRequest: "",
            description: "Rejected",
          },
        ),
      ).rejects.toThrow(/pattern|transport/i);
    });

    expect(reads).toBe(0);
  });
});
