# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a buildable MCP project with validated multi-system configuration, DPAPI credentials, TLS policies, per-system write policy, expiring change plans, audit logging, and a working CLI/server shell.

**Architecture:** Configuration, credentials, TLS, policy, and audit are independent modules with dependency-injected boundaries. The stdio MCP bootstrap exposes no SAP tools until a later phase, but it must start cleanly and reserve stdout exclusively for MCP traffic.

**Tech Stack:** TypeScript, Vitest, Zod, YAML, Undici, MCP SDK, Commander, Windows PowerShell DPAPI.

---

### Task 1: Scaffold the Package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `src/version.ts`
- Test: `tests/unit/version.test.ts`
- Test support: `tests/helpers/mcp.ts`
- Test support: `tests/helpers/sap-fixture.ts`
- Test support: `tests/helpers/assertions.ts`

- [ ] **Step 1: Create package and compiler configuration without `src/version.ts`**

Use the package identity and dependency set in Step 3, but do not create the version module yet. Run `npm.cmd install` so Vitest can execute.

- [ ] **Step 2: Write and run the failing version test**

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_VERSION } from "../../src/version.js";

describe("version metadata", () => {
  it("uses the independent local product identity", () => {
    expect(APP_NAME).toBe("mcp-sap-adt-local");
    expect(APP_VERSION).toMatch(/^0\.1\.0$/);
  });
});
```

Run:

```powershell
npm.cmd run test -- tests/unit/version.test.ts
```

Expected RED: failure because `src/version.ts` does not exist.

- [ ] **Step 3: Add the version module and shared test harness, then make the test green**

Use this package identity and dependency set:

```json
{
  "name": "mcp-sap-adt-local",
  "version": "0.1.0",
  "description": "Local multi-system SAP ADT and allowlisted OData MCP server",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.18.1" },
  "bin": { "mcp-sap-adt-local": "dist/cli/index.js" },
  "main": "dist/server.js",
  "files": ["dist", "skills", "config", "docs", "LICENSE", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:mcp": "vitest run tests/mcp",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "biome check src tests",
    "check": "npm run test && npm run typecheck && npm run lint && npm run build"
  },
  "dependencies": {
    "@mcp-abap-adt/adt-clients": "10.1.0",
    "@mcp-abap-adt/interfaces": "13.1.0",
    "@modelcontextprotocol/sdk": "1.29.0",
    "commander": "14.0.3",
    "fast-xml-parser": "5.9.3",
    "undici": "7.16.0",
    "yaml": "2.8.1",
    "zod": "4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.4",
    "@types/node": "22.18.0",
    "typescript": "5.9.2",
    "vitest": "3.2.4"
  }
}
```

Create `src/version.ts`:

```ts
export const APP_NAME = "mcp-sap-adt-local";
export const APP_VERSION = "0.1.0";
```

Create the shared helper functions with the exact signatures defined in the master plan. `startTestMcpServer` owns child-process cleanup; `startSapFixture` binds only to loopback on an ephemeral port; `hash` uses SHA-256.

Verify:

Run:

```powershell
npm.cmd run test -- tests/unit/version.test.ts
```

Expected GREEN: one passing test and a generated `package-lock.json`.

- [ ] **Step 4: Commit the scaffold and harness**

```powershell
git add package.json package-lock.json tsconfig.json vitest.config.ts biome.json .gitignore LICENSE src/version.ts tests/helpers tests/unit/version.test.ts
git commit -m "chore: scaffold mcp sap adt local"
```

### Task 2: Validate Multi-System Configuration

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/load-config.ts`
- Create: `src/config/types.ts`
- Create: `config/systems.example.yaml`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing policy-oriented configuration tests**

```ts
import { describe, expect, it } from "vitest";
import { parseSystemsConfig } from "../../src/config/schema.js";

const valid = {
  version: 1,
  systems: [{
    id: "SAH",
    label: "SAH Client 400",
    kind: "s4hana-op",
    environment: "non-production",
    connection: { protocol: "https", host: "sap.example.com", port: 44300, client: "400", language: "1", serverTimezone: "Asia/Shanghai" },
    auth: { type: "basic", username: "DEMO_USER", credentialRef: "SAH" },
    tls: { mode: "pinned", fingerprintSha256: "A0:A1:A2:A3:A4:A5:A6:A7:A8:A9:AA:AB:AC:AD:AE:AF:B0:B1:B2:B3:B4:B5:B6:B7:B8:B9:BA:BB:BC:BD:BE:BF", allowExpired: true },
    access: { read: true, adtDevelopmentWrite: true, businessApiWrite: true },
    development: { objectNamePatterns: ["Z*", "Y*"], requireTransport: true },
    businessApis: { enabledProfiles: ["s4-core-masterdata-approved"] },
    limits: { requestTimeoutMs: 30000, rateLimitPerMin: 60, maxSourceLines: 5000 }
  }]
};

describe("systems configuration", () => {
  it("accepts a configured non-production write system", () => expect(parseSystemsConfig(valid).systems[0].id).toBe("SAH"));
  it("rejects production write flags", () => {
    const input = structuredClone(valid);
    input.systems[0].environment = "production";
    expect(() => parseSystemsConfig(input)).toThrow(/production.*read-only/i);
  });
  it("rejects duplicate system ids", () => expect(() => parseSystemsConfig({ ...valid, systems: [valid.systems[0], valid.systems[0]] })).toThrow(/duplicate/i));
});
```

- [ ] **Step 2: Implement the Zod schema and YAML loader**

Define discriminated TLS modes `strict`, `custom-ca`, `pinned`, and `insecure`; require HTTPS; require a 3-digit client; normalize IDs to uppercase; and reject write flags on production systems in `superRefine`.

Expose these exact functions:

```ts
export function parseSystemsConfig(input: unknown): SystemsConfig;
export async function loadSystemsConfig(path: string): Promise<SystemsConfig>;
export function getSystem(config: SystemsConfig, id: string): SapSystemConfig;
```

- [ ] **Step 3: Run focused and full tests**

```powershell
npm.cmd run test -- tests/unit/config.test.ts
npm.cmd run typecheck
```

Expected: all configuration tests pass and TypeScript exits `0`.

- [ ] **Step 4: Commit configuration**

```powershell
git add src/config config/systems.example.yaml tests/unit/config.test.ts
git commit -m "feat: validate multi system configuration"
```

### Task 3: Add Windows DPAPI Credential Storage

**Files:**
- Create: `src/credentials/credential-store.ts`
- Create: `src/credentials/dpapi-runner.ts`
- Create: `scripts/dpapi.ps1`
- Test: `tests/unit/credential-store.test.ts`

- [ ] **Step 1: Write failing credential-store tests with an injected protector**

```ts
import { describe, expect, it } from "vitest";
import { CredentialStore } from "../../src/credentials/credential-store.js";

describe("CredentialStore", () => {
  it("stores only protected text", async () => {
    const files = new Map<string, string>();
    const store = new CredentialStore({ protect: async value => `protected:${value}`, unprotect: async value => value.slice(10) }, {
      read: async path => files.get(path), write: async (path, value) => void files.set(path, value), remove: async path => void files.delete(path)
    }, "C:/secure/credentials.json");
    await store.set("SAH", "secret");
    expect([...files.values()][0]).not.toContain("secret\"");
    expect(await store.get("SAH")).toBe("secret");
  });
});
```

- [ ] **Step 2: Implement DPAPI using CurrentUser scope**

The PowerShell script accepts `protect` or `unprotect`, reads one UTF-8 line from stdin, and uses `System.Security.Cryptography.ProtectedData` with `DataProtectionScope.CurrentUser`. Node calls it through `spawnFile` without placing the password on the command line.

`CredentialStore` writes this JSON shape atomically:

```json
{ "version": 1, "credentials": { "SAH": "BASE64_DPAPI_CIPHERTEXT" } }
```

- [ ] **Step 3: Run tests and a Windows-only round trip**

```powershell
npm.cmd run test -- tests/unit/credential-store.test.ts
npm.cmd run build
```

Then execute a test helper that protects and unprotects `round-trip-only` and prints only `DPAPI_ROUND_TRIP=PASS`.

- [ ] **Step 4: Commit credential storage**

```powershell
git add src/credentials scripts/dpapi.ps1 tests/unit/credential-store.test.ts
git commit -m "feat: protect sap credentials with dpapi"
```

### Task 4: Implement TLS Trust Modes

**Files:**
- Create: `src/tls/certificate.ts`
- Create: `src/tls/tls-policy.ts`
- Create: `src/tls/create-dispatcher.ts`
- Test: `tests/unit/tls-policy.test.ts`
- Test: `tests/contract/tls-fixture.test.ts`

- [ ] **Step 1: Write failing certificate policy tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateCertificate } from "../../src/tls/tls-policy.js";

describe("TLS policy", () => {
  it("accepts an expired certificate only when host and fingerprint are pinned", () => {
    expect(evaluateCertificate({ mode: "pinned", allowExpired: true, fingerprintSha256: "AA:BB" }, { hostnameMatches: true, expired: true, fingerprintSha256: "AA:BB" })).toEqual({ allowed: true, writeAllowed: true });
  });
  it("rejects a changed pinned certificate", () => {
    expect(evaluateCertificate({ mode: "pinned", allowExpired: true, fingerprintSha256: "AA:BB" }, { hostnameMatches: true, expired: true, fingerprintSha256: "CC:DD" }).allowed).toBe(false);
  });
  it("marks insecure transport read-only", () => expect(evaluateCertificate({ mode: "insecure" }, { hostnameMatches: false, expired: true, fingerprintSha256: "CC:DD" }).writeAllowed).toBe(false));
});
```

- [ ] **Step 2: Implement strict, custom CA, pinned, and insecure dispatchers**

Expose:

```ts
export type TlsDecision = { allowed: boolean; writeAllowed: boolean; reason?: string };
export function evaluateCertificate(policy: TlsConfig, observed: ObservedCertificate): TlsDecision;
export async function inspectCertificate(system: SapSystemConfig): Promise<ObservedCertificate>;
export function createSapDispatcher(system: SapSystemConfig): Dispatcher;
```

Pinned mode must validate the hostname and exact normalized SHA-256 fingerprint on every new TLS connection. A preflight-only check is insufficient. `insecure` may use `rejectUnauthorized: false` but returns `writeAllowed: false` to policy checks.

- [ ] **Step 3: Verify against local TLS fixtures**

```powershell
npm.cmd run test -- tests/unit/tls-policy.test.ts tests/contract/tls-fixture.test.ts
```

Expected: exact fingerprint accepted, changed fingerprint rejected, strict expired certificate rejected, pinned expired certificate accepted.

- [ ] **Step 4: Commit TLS policy**

```powershell
git add src/tls tests/unit/tls-policy.test.ts tests/contract/tls-fixture.test.ts
git commit -m "feat: add strict ca pinned and insecure tls modes"
```

### Task 5: Add Access Policy, Change Plans, and Audit

**Files:**
- Create: `src/policy/access-policy.ts`
- Create: `src/change-plans/change-plan-store.ts`
- Create: `src/audit/audit-log.ts`
- Test: `tests/unit/access-policy.test.ts`
- Test: `tests/unit/change-plan-store.test.ts`
- Test: `tests/unit/audit-log.test.ts`

- [ ] **Step 1: Write failing policy and plan tests**

```ts
it("requires non-production, write flag, and trusted write TLS", () => {
  expect(() => requireWriteAccess(system, "adt-development", { allowed: true, writeAllowed: false })).toThrow(/TLS/i);
});

it("expires plans after ten minutes", () => {
  const store = new ChangePlanStore(() => new Date("2026-08-09T00:11:00Z"));
  store.put({ id: "plan-1", createdAt: "2026-08-09T00:00:00Z", expiresAt: "2026-08-09T00:10:00Z", kind: "development", systemId: "SAH", target: "ZR_TEST", expectedHash: "abc", request: {} });
  expect(() => store.consume("plan-1")).toThrow(/expired/i);
});
```

- [ ] **Step 2: Implement exact policy and audit contracts**

```ts
export type WriteKind = "adt-development" | "business-api";
export function requireReadAccess(system: SapSystemConfig): void;
export function requireWriteAccess(system: SapSystemConfig, kind: WriteKind, tls: TlsDecision): void;

export interface ChangePlan<T> {
  id: string;
  kind: "development" | "business";
  systemId: string;
  target: string;
  createdAt: string;
  expiresAt: string;
  expectedHash?: string;
  expectedEtag?: string;
  request: T;
}
```

Audit writes one JSON object per line through an injected append-only writer. Redact keys matching `password`, `authorization`, `cookie`, `token`, `secret`, and configured business-sensitive fields.

- [ ] **Step 3: Run tests**

```powershell
npm.cmd run test -- tests/unit/access-policy.test.ts tests/unit/change-plan-store.test.ts tests/unit/audit-log.test.ts
```

Expected: all tests pass with no secret text in audit output.

- [ ] **Step 4: Commit safety foundation**

```powershell
git add src/policy src/change-plans src/audit tests/unit
git commit -m "feat: gate writes with expiring audited plans"
```

### Task 6: Add CLI and MCP Bootstrap

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands.ts`
- Create: `src/server.ts`
- Create: `src/runtime/context.ts`
- Test: `tests/unit/cli.test.ts`
- Test: `tests/mcp/server-start.test.ts`

- [ ] **Step 1: Write failing CLI and MCP startup tests**

```ts
it("does not expose activation or licensing commands", () => {
  const names = buildCli().commands.map(command => command.name());
  expect(names).toEqual(["serve", "login", "logout", "list-systems", "doctor", "trust-certificate", "install-skills"]);
});

it("starts an MCP server with an empty phase-one tool list", async () => {
  const client = await startTestMcpServer();
  expect((await client.listTools()).tools).toEqual([]);
});
```

- [ ] **Step 2: Implement commands and stdio bootstrap**

`serve` loads configuration and credentials, creates `RuntimeContext`, then connects `McpServer` to `StdioServerTransport`. Logging goes only to stderr. `doctor` reports configuration, credential presence, TLS decision, and access flags without showing secret values.

Add this shebang to `src/cli/index.ts`:

```ts
#!/usr/bin/env node
import { buildCli } from "./commands.js";
await buildCli().parseAsync(process.argv);
```

- [ ] **Step 3: Run MCP startup verification**

```powershell
npm.cmd run test -- tests/unit/cli.test.ts tests/mcp/server-start.test.ts
npm.cmd run build
node dist/cli/index.js --help
```

Expected: tests pass, build exits `0`, and help contains no activation or license command.

- [ ] **Step 4: Commit CLI bootstrap**

```powershell
git add src/cli src/runtime src/server.ts tests/unit/cli.test.ts tests/mcp/server-start.test.ts
git commit -m "feat: add local cli and mcp bootstrap"
```

### Task 7: Run the Phase 1 Gate

- [ ] **Step 1: Run all local verification**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
git status --short
```

Expected: tests, type checking, lint, and build exit `0`; `git status --short` is empty.

- [ ] **Step 2: Record the gate**

Add `docs/verification/phase-1.md` with command, UTC timestamp, test count, and exact exit status, then commit:

```powershell
git add docs/verification/phase-1.md
git commit -m "docs: record phase one verification"
```
