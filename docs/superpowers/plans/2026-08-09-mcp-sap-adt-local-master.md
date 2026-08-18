# MCP SAP ADT Local Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a permanently usable, multi-system SAP MCP server with 16 read-compatible tools, controlled Z/Y program writes, generic allowlisted OData master-data writes, and three packaged SAP skills.

**Architecture:** One TypeScript stdio MCP server owns configuration, Windows DPAPI credentials, TLS policy, access policy, audit, and change plans. It uses the MIT-licensed `@mcp-abap-adt/adt-clients` package behind a project-owned `IAbapConnection` adapter for ADT, and a separate project-owned OData client for business APIs.

**Tech Stack:** Node.js 20.18.1+, TypeScript 5.9, MCP SDK 1.29, Zod 4, YAML 2.8, Undici 7, fast-xml-parser 5.9, `@mcp-abap-adt/adt-clients` 10.1, Vitest, Biome.

---

## Execution Order

Execute and complete these plans in order:

1. `docs/superpowers/plans/2026-08-09-phase-1-foundation.md`
2. `docs/superpowers/plans/2026-08-09-phase-2-read-parity.md`
3. `docs/superpowers/plans/2026-08-09-phase-3-controlled-development.md`
4. `docs/superpowers/plans/2026-08-09-phase-4-business-odata.md`
5. `docs/superpowers/plans/2026-08-09-phase-5-skills-delivery.md`

Each phase ends with a full gate. Do not start the next phase until the current phase's unit tests, type checking, lint, build, and listed integration checks pass.

Live SAP writes are never part of an automatic gate. They require a fresh prepared change plan and a separate user approval at execution time.

## Mandatory TDD Rule

For every task that introduces behavior:

1. Add only the test and any inert fixture data.
2. Run the exact focused test command shown in that task before implementation.
3. Confirm it fails because the named function, behavior, or registration is absent; compilation typos do not count as the RED result.
4. Add the minimal implementation described by the task.
5. Run the same focused command and confirm it passes before the commit step.

The shared test harness is created in Phase 1 and exports these stable helpers used by later plans:

```ts
export async function startTestMcpServer(options?: TestServerOptions): Promise<TestMcpClient>;
export async function startSapFixture(options?: SapFixtureOptions): Promise<SapFixture>;
export function indexByName<T extends { name: string }>(items: T[]): Record<string, T>;
export function requiredKeys(tool: { inputSchema: { required?: string[] } }): string[];
export function hash(value: string): string;
```

Each test file creates its own typed dependency fixture named `deps`; no undeclared global test state is permitted.

## Dependency Decision

Use these public MIT packages:

- `@mcp-abap-adt/adt-clients@10.1.0`
- `@mcp-abap-adt/interfaces@13.1.0`

Do not depend on `mcp-sap-assistant`, import its distribution files, read its internal implementation, or migrate its encrypted credential file. Do not expose the ADT library's generic CRUD or delete surface through MCP. Only the handlers defined in this project's plans are registered.

## Completion Gate

Run from the project root:

```powershell
npm.cmd ci
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:mcp
npm.cmd pack --dry-run
```

Expected: every command exits `0`; no test is skipped except tests carrying the explicit `LIVE_SAP` guard; the package manifest contains no trial, activation, machine-ID, or license-server dependency.
