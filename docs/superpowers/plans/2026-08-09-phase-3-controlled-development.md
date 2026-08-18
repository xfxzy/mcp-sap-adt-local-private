# Phase 3 Controlled Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add prepare, apply, and verify tools for Z/Y executable program creation and update with activation, optimistic concurrency, explicit approval, and audit.

**Architecture:** MCP handlers never call ADT writes directly. Preparation reads local source and SAP state into an expiring in-memory plan; application consumes that plan once, rechecks the current source hash, and invokes only the narrow program operations of the MIT ADT client.

**Tech Stack:** `@mcp-abap-adt/adt-clients`, TypeScript, Zod, SHA-256, Vitest.

---

### Task 1: Validate Development Requests and Local Source

**Files:**
- Create: `src/development/program-request.ts`
- Create: `src/development/source-file.ts`
- Test: `tests/unit/program-request.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
it.each(["SAPMSSY1", "CL_TEST", "ZR-BAD", ""])('rejects unsafe program name %s', name => {
  expect(() => validateProgramName(name, ["Z*", "Y*"])).toThrow();
});

it("accepts a bounded executable Z report", () => {
  const result = validateProgramSource("ZR_MCP_ADT_LOCAL_SMOKE", "REPORT zr_mcp_adt_local_smoke.\nWRITE / 'OK'.", 200_000);
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Implement validation**

Normalize program names to uppercase; require `Z` or `Y` glob match; reject path traversal; read UTF-8 from the exact supplied local path; cap source bytes; require the first non-comment statement to be `REPORT` or `PROGRAM`; compute SHA-256; and never accept source text directly in an MCP argument.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/program-request.test.ts
git add src/development tests/unit/program-request.test.ts
git commit -m "feat: validate local z y program changes"
```

### Task 2: Prepare Development Change Plans

**Files:**
- Create: `src/development/program-reader.ts`
- Create: `src/development/prepare-program-change.ts`
- Test: `tests/unit/prepare-program-change.test.ts`

- [ ] **Step 1: Write failing create and update plan tests**

```ts
it("binds an update plan to current and requested hashes", async () => {
  const plan = await prepareProgramChange(deps, {
    systemId: "SAH", action: "update", programName: "ZR_TEST", sourcePath: "C:/work/ZR_TEST.abap",
    packageName: "ZLOCAL", transportRequest: "S4HK900001", description: "Controlled update"
  });
  expect(plan.expectedHash).toBe(hash("REPORT zr_test.\nWRITE / 'OLD'."));
  expect(plan.request.sourceHash).toBe(hash("REPORT zr_test.\nWRITE / 'NEW'."));
  expect(plan.diff).toContain("-WRITE / 'OLD'.");
});
```

- [ ] **Step 2: Implement preparation**

For create, require SAP to report the object absent. For update, require it present and active. Verify package and transport fields are supplied according to system policy. Store source text only inside the in-memory plan; return program name, package, transport, description, source hash, current hash, and unified diff to MCP.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/prepare-program-change.test.ts
git add src/development/program-reader.ts src/development/prepare-program-change.ts tests/unit/prepare-program-change.test.ts
git commit -m "feat: prepare audited program change plans"
```

### Task 3: Apply and Verify Program Changes

**Files:**
- Create: `src/development/program-writer.ts`
- Create: `src/development/apply-program-change.ts`
- Create: `src/development/verify-program.ts`
- Test: `tests/contract/program-writer.test.ts`
- Test: `tests/unit/apply-program-change.test.ts`

- [ ] **Step 1: Write failing one-shot and concurrency tests**

```ts
it("refuses an update when SAP changed after prepare", async () => {
  deps.reader.readActiveSource.mockResolvedValue("REPORT zr_test.\nWRITE / 'OTHER'.");
  await expect(applyProgramChange(deps, { planId: "plan-1", approveWrite: true })).rejects.toThrow(/changed since prepare/i);
  expect(deps.writer.update).not.toHaveBeenCalled();
});

it("consumes an applied plan exactly once", async () => {
  await applyProgramChange(deps, { planId: "plan-1", approveWrite: true });
  await expect(applyProgramChange(deps, { planId: "plan-1", approveWrite: true })).rejects.toThrow(/not found|consumed/i);
});
```

- [ ] **Step 2: Implement narrow ADT program writes**

Use:

```ts
const program = adtClient.getProgram();
await program.create({
  programName,
  packageName,
  transportRequest,
  description,
  sourceCode,
  activate: true
});

await program.update({ programName, packageName, transportRequest }, { sourceCode, activate: true });
```

Wrap the library behind `ProgramWriter` so no delete or generic CRUD object escapes. After write, poll active reads with a bounded deadline and verify exact normalized source hash and active metadata. Never retry create/update automatically.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/contract/program-writer.test.ts tests/unit/apply-program-change.test.ts
npm.cmd run typecheck
git add src/development tests/contract/program-writer.test.ts tests/unit/apply-program-change.test.ts
git commit -m "feat: apply activate and verify z y programs"
```

### Task 4: Register the Three Development MCP Tools

**Files:**
- Create: `src/tools/development/program-tools.ts`
- Test: `tests/mcp/program-tools.test.ts`

- [ ] **Step 1: Write failing MCP schema tests**

```ts
const indexByName = <T extends { name: string }>(items: T[]) => Object.fromEntries(items.map(item => [item.name, item]));
const requiredKeys = (tool: { inputSchema: { required?: string[] } }) => tool.inputSchema.required ?? [];

it("requires explicit approval only on apply", async () => {
  const tools = indexByName((await client.listTools()).tools);
  expect(requiredKeys(tools.prepare_z_program_change)).not.toContain("approveWrite");
  expect(requiredKeys(tools.apply_z_program_change)).toContain("approveWrite");
  expect(requiredKeys(tools.verify_z_program)).toContain("programName");
});
```

- [ ] **Step 2: Register exact tools**

`prepare_z_program_change` accepts `systemId`, `action`, `programName`, `sourcePath`, `packageName`, `transportRequest`, and `description`. `apply_z_program_change` accepts only `planId` and literal boolean `approveWrite`. `verify_z_program` accepts `systemId`, `programName`, `packageName`, and optional `expectedHash`.

- [ ] **Step 3: Run MCP tests and commit**

```powershell
npm.cmd run test -- tests/mcp/program-tools.test.ts
git add src/tools/development/program-tools.ts tests/mcp/program-tools.test.ts
git commit -m "feat: expose controlled program development tools"
```

### Task 5: Verify Safety Rejections and Prepare Live SAH Acceptance

**Files:**
- Create: `scripts/live-development-smoke.ts`
- Create: `docs/verification/phase-3.md`

- [ ] **Step 1: Run the automatic safety matrix**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected tests include: production rejected, insecure TLS rejected, standard name rejected, missing transport rejected, expired plan rejected, changed hash rejected, approval false rejected, second apply rejected, delete absent from tool inventory.

- [ ] **Step 2: Run prepare-only against SAH**

Create a local source file for the stable test program `ZR_MCP_ADT_LOCAL_SMOKE`. Run `prepare_z_program_change` only. Confirm the response identifies create or update, displays exact package/transport, and contains no unexpected object.

- [ ] **Step 3: Stop for explicit live-write approval**

Present the prepared plan ID, program name, package, transport, action, source hash, and diff to the user. Do not call apply until the user explicitly approves that exact plan.

- [ ] **Step 4: After approval, apply and verify**

Run apply once, then `verify_z_program` with the expected hash. Record SAP response, activation status, and verification hash in `docs/verification/phase-3.md` without full source or credentials.

- [ ] **Step 5: Commit the verified phase**

```powershell
git add scripts/live-development-smoke.ts docs/verification/phase-3.md
git commit -m "test: verify controlled program development on sah"
```
