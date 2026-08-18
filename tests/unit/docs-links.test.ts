import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("documentation links", () => {
  it("resolves local markdown links and names the supported commands", async () => {
    const files = [
      "README.md",
      ...(await readdir(join(root, "docs")))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `docs/${name}`),
    ];
    const broken: string[] = [];
    const commands = [
      "serve",
      "login",
      "logout",
      "list-systems",
      "doctor",
      "trust-certificate",
      "install-skills",
    ];
    let combined = "";
    for (const relative of files) {
      const source = await readFile(join(root, relative), "utf8");
      combined += source;
      for (const match of source.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        const target = match[1];
        if (target && !/^https?:/i.test(target)) {
          try {
            await access(
              join(
                root,
                relative.includes("/")
                  ? relative.slice(0, relative.lastIndexOf("/"))
                  : "",
                target,
              ),
            );
          } catch {
            broken.push(`${relative}:${target}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
    for (const command of commands) expect(combined).toContain(command);
  });
});
