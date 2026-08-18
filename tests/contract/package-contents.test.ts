import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execAsync = promisify(exec);

describe("npm package contents", () => {
  it("ships runtime, config, docs, and skills without license enforcement modules", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    await execAsync("npm.cmd run build", { cwd: root, windowsHide: true });
    const { stdout } = await execAsync(
      "npm.cmd pack --dry-run --json --ignore-scripts",
      { cwd: root, windowsHide: true },
    );
    const files = (
      JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>
    )[0].files.map((entry) => entry.path);
    expect(files).toContain("dist/cli/index.js");
    expect(files).toContain("config/systems.example.yaml");
    expect(files).toContain("skills/sap-code-to-fs/SKILL.md");
    expect(
      files.filter((file) =>
        /activation|trial|machine-id|license-server/i.test(file),
      ),
    ).toEqual([]);
  }, 90_000);
});
