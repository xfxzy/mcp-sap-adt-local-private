import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

export const REQUIRED_SKILLS = [
  "sap-code-to-fs",
  "sap-dump-diagnose",
  "sap-interface-diagnose",
] as const;

export interface SkillPackageReport {
  skillNames: string[];
  missingFiles: string[];
  frontmatterNames: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function frontmatterName(source: string): string | undefined {
  if (!source.startsWith("---")) return undefined;
  const end = source.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const value = parse(source.slice(3, end)) as unknown;
  if (typeof value !== "object" || value === null) return undefined;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

export async function inspectPackagedSkills(
  root: string,
): Promise<SkillPackageReport> {
  const skillNames = (await readdir(root, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        REQUIRED_SKILLS.includes(
          entry.name as (typeof REQUIRED_SKILLS)[number],
        ),
    )
    .map((entry) => entry.name)
    .sort();
  const missingFiles: string[] = [];
  const frontmatterNames: string[] = [];
  for (const name of REQUIRED_SKILLS) {
    const skillRoot = join(root, name);
    const entry = join(skillRoot, "SKILL.md");
    if (!(await exists(entry))) missingFiles.push(`${name}/SKILL.md`);
    else {
      const frontmatter = frontmatterName(await readFile(entry, "utf8"));
      if (frontmatter) frontmatterNames.push(frontmatter);
    }
    if (name === "sap-code-to-fs") {
      for (const relative of [
        "references/fs-template.md",
        "templates.json",
        "assets/word-templates/default.docx",
      ])
        if (!(await exists(join(skillRoot, relative))))
          missingFiles.push(`${name}/${relative}`);
    }
  }
  return { skillNames, missingFiles, frontmatterNames };
}
