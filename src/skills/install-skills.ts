import { access, cp, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPackagedSkills, REQUIRED_SKILLS } from "./skill-manifest.js";

export interface InstallSkillsOptions {
  source: string;
  target: string;
  overwrite?: boolean;
  now?: () => Date;
}

export interface InstallSkillsResult {
  installed: string[];
  backups: string[];
}

export async function installSkills(
  options: InstallSkillsOptions,
): Promise<InstallSkillsResult> {
  const source = resolve(options.source);
  const target = resolve(options.target);
  const report = await inspectPackagedSkills(source);
  if (report.missingFiles.length)
    throw new Error(
      `Skill package is incomplete: ${report.missingFiles.join(", ")}`,
    );
  await mkdir(target, { recursive: true });
  const preExisting: string[] = [];
  for (const name of REQUIRED_SKILLS) {
    try {
      await access(join(target, name));
      preExisting.push(name);
    } catch {
      /* absent */
    }
  }
  if (preExisting.length && !options.overwrite)
    throw new Error(`Skill already exists: ${preExisting.join(", ")}`);
  const stage = await mkdtemp(join(target, ".mcp-sap-adt-local-staging-"));
  const backups: string[] = [];
  try {
    for (const name of REQUIRED_SKILLS)
      await cp(join(source, name), join(stage, name), { recursive: true });
    const stamp = (options.now ?? (() => new Date()))()
      .toISOString()
      .replaceAll(/[^0-9]/g, "")
      .slice(0, 14);
    for (const name of REQUIRED_SKILLS) {
      const destination = join(target, name);
      if (preExisting.includes(name)) {
        const backup = join(target, `${name}.backup-${stamp}`);
        await rename(destination, backup);
        backups.push(backup);
      }
      await rename(join(stage, name), destination);
    }
    return { installed: [...REQUIRED_SKILLS], backups };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export function defaultCodexSkillsPath(): string {
  const root =
    process.env.CODEX_HOME ??
    join(process.env.USERPROFILE ?? process.cwd(), ".codex");
  return join(root, "skills");
}

export function defaultSkillSourcePath(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}
