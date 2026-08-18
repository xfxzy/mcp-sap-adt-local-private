# Phase 5 Skills and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the three SAP skills, write Chinese installation and operations documentation, install the local MCP server beside the proprietary package, and complete reproducible delivery verification.

**Architecture:** Skills are versioned source assets in this repository and installed by a conservative copy command. Packaging uses npm with MIT licensing; Codex registers the new server under a distinct name so migration is reversible.

**Tech Stack:** Node.js file APIs, SHA-256 verification, npm packaging, Codex TOML configuration, Markdown documentation.

---

### Task 1: Normalize and Package the Three Skills

**Files:**
- Create: `skills/sap-code-to-fs/SKILL.md`
- Create: `skills/sap-code-to-fs/references/fs-template.md`
- Create: `skills/sap-code-to-fs/templates.json`
- Create: `skills/sap-code-to-fs/assets/word-templates/default.docx`
- Create: `skills/sap-dump-diagnose/SKILL.md`
- Create: `skills/sap-interface-diagnose/SKILL.md`
- Create: `src/skills/skill-manifest.ts`
- Test: `tests/unit/skill-package.test.ts`

- [ ] **Step 1: Write failing skill package tests**

```ts
it("contains three standard skill entry points and the FS assets", async () => {
  const result = await inspectPackagedSkills(projectRoot);
  expect(result.skillNames).toEqual(["sap-code-to-fs", "sap-dump-diagnose", "sap-interface-diagnose"]);
  expect(result.missingFiles).toEqual([]);
  expect(result.frontmatterNames).toEqual(result.skillNames);
});
```

- [ ] **Step 2: Copy and normalize user-provided sources**

Copy from these exact parent-workspace files:

```text
../sap-code-to-fs/SKILL.md
../sap-code-to-fs/references/fs-template.md
../sap-code-to-fs/templates.json
../sap-code-to-fs/assets/word-templates/default.docx
../sap-dump-diagnose/SKILL-2.md
../sap-interface-diagnose/SKILL-3.md
```

Rename the last two entry points to `SKILL.md` inside this project. Preserve content and UTF-8 encoding. Record source and destination SHA-256 values for every unchanged file; the renamed Markdown files must retain the same byte hash as their source.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/skill-package.test.ts
git add skills src/skills tests/unit/skill-package.test.ts
git commit -m "feat: package sap diagnostic and fs skills"
```

### Task 2: Implement Conservative Skill Installation

**Files:**
- Create: `src/skills/install-skills.ts`
- Test: `tests/unit/install-skills.test.ts`

- [ ] **Step 1: Write failing no-overwrite tests**

```ts
it("refuses to overwrite an existing skill by default", async () => {
  await fs.mkdir(path.join(target, "sap-code-to-fs"), { recursive: true });
  await fs.writeFile(path.join(target, "sap-code-to-fs", "SKILL.md"), "user version");
  await expect(installSkills({ source, target, overwrite: false })).rejects.toThrow(/already exists/i);
  expect(await fs.readFile(path.join(target, "sap-code-to-fs", "SKILL.md"), "utf8")).toBe("user version");
});
```

- [ ] **Step 2: Implement atomic installation**

Resolve Codex skills to `%USERPROFILE%\.codex\skills` unless `CODEX_HOME` is explicitly set. Stage each skill in a target-local temporary directory, verify the manifest, then rename into place. `--overwrite` first moves the existing target to a timestamped backup rather than deleting it.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/install-skills.test.ts
git add src/skills/install-skills.ts tests/unit/install-skills.test.ts
git commit -m "feat: install packaged skills without destructive overwrite"
```

### Task 3: Write Configuration and Operations Documentation

**Files:**
- Create: `README.md`
- Create: `docs/安装与启动手册.md`
- Create: `docs/多系统配置手册.md`
- Create: `docs/证书与TLS手册.md`
- Create: `docs/只读工具清单.md`
- Create: `docs/Z_Y程序受控修改手册.md`
- Create: `docs/OData主数据读写手册.md`
- Create: `docs/迁移与回退手册.md`
- Test: `tests/unit/docs-links.test.ts`

- [ ] **Step 1: Write failing documentation-link tests**

```ts
it("resolves every local Markdown link and named command", async () => {
  const report = await validateDocs(projectRoot, ["serve", "login", "logout", "list-systems", "doctor", "trust-certificate", "install-skills"]);
  expect(report.brokenLinks).toEqual([]);
  expect(report.missingCommands).toEqual([]);
});
```

- [ ] **Step 2: Write user-facing Chinese manuals**

Document exact Windows commands for installation, `systems.yaml`, `business-apis.yaml`, DPAPI login, pinned expired certificates, Codex MCP registration, all 16 read tools, prepare/apply/verify flows, audit logs, multiple customer test systems, production read-only enforcement, parallel migration, rollback, and troubleshooting.

The manuals must state that standard OData availability depends on the target SAP system and that direct table writes, arbitrary URLs, standard-object changes, deletes, and transport release are unavailable by design.

- [ ] **Step 3: Run link tests and commit**

```powershell
npm.cmd run test -- tests/unit/docs-links.test.ts
git add README.md docs tests/unit/docs-links.test.ts
git commit -m "docs: add chinese installation and operations manuals"
```

### Task 4: Package and Register Beside the Existing Server

**Files:**
- Create: `scripts/install-local.ps1`
- Create: `scripts/register-codex.ps1`
- Create: `tests/contract/package-contents.test.ts`
- Create: `docs/verification/phase-5.md`

- [ ] **Step 1: Write failing package-content tests**

```ts
it("ships runtime, examples, docs, skills, and no license enforcement module", async () => {
  const files = await npmPackDryRun(projectRoot);
  expect(files).toContain("dist/cli/index.js");
  expect(files).toContain("config/systems.example.yaml");
  expect(files).toContain("skills/sap-code-to-fs/SKILL.md");
  expect(files.some(file => /activation|trial|machine-id|license-server/i.test(file))).toBe(false);
});
```

- [ ] **Step 2: Implement installation and Codex registration**

`install-local.ps1` checks Node.js, runs `npm ci`, `npm run check`, `npm pack`, and `npm install -g` on the generated local tarball. `register-codex.ps1` adds a distinct `[mcp_servers.mcp-sap-adt-local]` entry pointing to `mcp-sap-adt-local.cmd serve` and the chosen config paths. It backs up `config.toml`, preserves the existing `mcp-sap-assistant` entry, and prints the exact restart instruction.

- [ ] **Step 3: Test package and scripts**

```powershell
npm.cmd run test -- tests/contract/package-contents.test.ts
npm.cmd run check
npm.cmd pack --dry-run
```

Expected: all exit `0`; package contains only planned runtime/docs/skills/config files.

- [ ] **Step 4: Install and register locally**

Run the installer, verify `mcp-sap-adt-local --version`, `--help`, `doctor --system SAH`, and `list-systems`. Run the Codex registration script and restart Codex only after showing the config diff to the user.

- [ ] **Step 5: Commit packaging**

```powershell
git add scripts tests/contract/package-contents.test.ts docs/verification/phase-5.md
git commit -m "build: package and register local sap mcp"
```

### Task 5: Final Verification and Reversible Migration

**Files:**
- Create: `docs/verification/final.md`

- [ ] **Step 1: Run the complete local gate fresh**

```powershell
npm.cmd ci
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:mcp
npm.cmd pack --dry-run
```

Record exact test counts, exits, package file count, package SHA-256, Node version, and timestamp.

- [ ] **Step 2: Run the live read gate**

Run all representative SAH read checks and confirm exact inventory of 16 read tools plus 3 development tools and 6 business tools. Empty diagnostic feeds count as valid empty results, not failures.

- [ ] **Step 3: Confirm prior write evidence**

Verify the Phase 3 Z/Y program hash and Phase 4 restored business entity state. Do not repeat live writes solely for the final gate.

- [ ] **Step 4: Verify permanent local ownership requirements**

Search source, built output, package manifest, and dependency metadata for runtime trial, activation-code, machine-ID, and remote-license logic. Distinguish the normal MIT `LICENSE` file from forbidden license enforcement. Confirm no runtime network destination exists outside configured SAP hosts.

- [ ] **Step 5: Keep rollback available**

Leave the existing proprietary MCP entry installed but disabled only after the user accepts the new server. Document the one-command/config edit needed to re-enable it. Do not uninstall it as part of automatic migration.

- [ ] **Step 6: Commit final evidence**

```powershell
git add docs/verification/final.md
git commit -m "docs: record final local sap mcp verification"
git status --short
```

Expected: final commit succeeds and working tree is clean.

