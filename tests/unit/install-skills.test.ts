import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultSkillSourcePath,
  installSkills,
} from "../../src/skills/install-skills.js";
import { inspectPackagedSkills } from "../../src/skills/skill-manifest.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("skill installation", () => {
  it("locates packaged skills independently of the current directory", async () => {
    const report = await inspectPackagedSkills(defaultSkillSourcePath());
    expect(report.missingFiles).toEqual([]);
  });

  it("refuses to overwrite an existing skill by default", async () => {
    const target = await mkdtemp(join(tmpdir(), "mcp-skills-"));
    roots.push(target);
    await mkdir(join(target, "sap-code-to-fs"));
    await writeFile(join(target, "sap-code-to-fs", "SKILL.md"), "user version");
    await expect(
      installSkills({
        source: fileURLToPath(new URL("../../skills/", import.meta.url)),
        target,
      }),
    ).rejects.toThrow(/already exists/i);
    expect(
      await readFile(join(target, "sap-code-to-fs", "SKILL.md"), "utf8"),
    ).toBe("user version");
  });

  it("backs up existing skills when overwrite is explicit", async () => {
    const target = await mkdtemp(join(tmpdir(), "mcp-skills-"));
    roots.push(target);
    await mkdir(join(target, "sap-code-to-fs"));
    await writeFile(join(target, "sap-code-to-fs", "SKILL.md"), "user version");
    const result = await installSkills({
      source: fileURLToPath(new URL("../../skills/", import.meta.url)),
      target,
      overwrite: true,
      now: () => new Date("2026-08-10T08:00:00.000Z"),
    });
    expect(result.backups).toHaveLength(1);
    expect(
      await readFile(join(target, "sap-code-to-fs", "SKILL.md"), "utf8"),
    ).not.toBe("user version");
  });
});
