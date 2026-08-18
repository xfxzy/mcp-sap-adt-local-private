# Phase 2 Read Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify all 16 public read-compatible SAP MCP tools through ADT without exposing generic write operations.

**Architecture:** A project-owned `SapHttpSession` implements authentication, cookies, CSRF, TLS, timeout, and rate limiting. `AdtConnectionAdapter` implements the MIT library's `IAbapConnection`; tool handlers call narrow read facades and return consistent MCP structured content.

**Tech Stack:** Undici, fast-xml-parser, `@mcp-abap-adt/adt-clients`, MCP SDK, Zod, Vitest.

---

### Task 1: Implement the SAP HTTP Session and ADT Adapter

**Files:**
- Create: `src/http/sap-http-session.ts`
- Create: `src/http/errors.ts`
- Create: `src/http/cookie-jar.ts`
- Create: `src/http/rate-limiter.ts`
- Create: `src/adt/adt-connection-adapter.ts`
- Test: `tests/unit/cookie-jar.test.ts`
- Test: `tests/contract/adt-connection.test.ts`

- [ ] **Step 1: Write failing session tests**

```ts
it("adds sap-client and sap-language to every ADT request", async () => {
  const fixture = await startSapFixture();
  const session = fixture.createSession();
  await session.request({ method: "GET", path: "/sap/bc/adt/discovery", semantic: "read" });
  expect(fixture.lastUrl.searchParams.get("sap-client")).toBe("400");
  expect(fixture.lastUrl.searchParams.get("sap-language")).toBe("1");
});

it("never retries a semantic write", async () => {
  const fixture = await startSapFixture({ responses: [503, 200] });
  await expect(fixture.createSession().request({ method: "POST", path: "/write", semantic: "write" })).rejects.toThrow(/503/);
  expect(fixture.requestCount).toBe(1);
});
```

- [ ] **Step 2: Implement the session and interface adapter**

Expose:

```ts
export interface SapRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  semantic: "read" | "write";
  timeoutMs?: number;
}

export class SapHttpSession {
  request<T = string>(request: SapRequest): Promise<SapHttpResponse<T>>;
  fetchCsrf(path: string): Promise<void>;
}

export class SapHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code = "SAP_HTTP_ERROR") {
    super(message);
  }
}

export class AdtConnectionAdapter implements IAbapConnection {
  connect(): Promise<void>;
  getBaseUrl(): Promise<string>;
  getSessionId(): string | null;
  setSessionType(type: "stateful" | "stateless"): void;
  makeAdtRequest<T = unknown, D = unknown>(options: IAbapRequestOptions): Promise<IAdtResponse<T, D>>;
}
```

Only requests explicitly marked by the development module may use semantic write. The adapter's default mapping is read; where-used POST is explicitly classified as semantically read-only.

- [ ] **Step 3: Run focused tests**

```powershell
npm.cmd run test -- tests/unit/cookie-jar.test.ts tests/contract/adt-connection.test.ts
npm.cmd run typecheck
```

Expected: client/language propagation, cookie persistence, bounded GET retry, and no write retry all pass.

- [ ] **Step 4: Commit the connection layer**

```powershell
git add src/http src/adt/adt-connection-adapter.ts tests/unit/cookie-jar.test.ts tests/contract/adt-connection.test.ts
git commit -m "feat: add sap http and adt connection layer"
```

### Task 2: Add System Activation and Health Tools

**Files:**
- Create: `src/systems/system-registry.ts`
- Create: `src/tools/read/system-tools.ts`
- Test: `tests/unit/system-registry.test.ts`
- Test: `tests/mcp/system-tools.test.ts`

- [ ] **Step 1: Write failing activation tests**

```ts
it("requires explicit activation before network tools", async () => {
  const registry = new SystemRegistry(config);
  expect(() => registry.requireActive("SAH")).toThrow(/not active/i);
  registry.setActive(["SAH"]);
  expect(registry.requireActive("SAH").id).toBe("SAH");
});
```

- [ ] **Step 2: Implement three MCP tools**

Register exact names and schemas:

```ts
export const SYSTEM_TOOL_NAMES = ["list_systems", "set_active_systems", "sap_system_info"] as const;
```

`list_systems` performs no network request and reports capabilities, environment, TLS mode, and write flags. `set_active_systems` accepts only configured IDs. `sap_system_info` calls ADT discovery and system-information resources, measures latency, and returns `reachable: true` only after both authentication and parsing succeed.

- [ ] **Step 3: Verify MCP calls**

```powershell
npm.cmd run test -- tests/unit/system-registry.test.ts tests/mcp/system-tools.test.ts
```

Expected: three tools are listed; a non-active system is rejected; fixture health information is returned.

- [ ] **Step 4: Commit system tools**

```powershell
git add src/systems src/tools/read/system-tools.ts tests/unit/system-registry.test.ts tests/mcp/system-tools.test.ts
git commit -m "feat: add system discovery and activation tools"
```

### Task 3: Add Repository and Source Tools

**Files:**
- Create: `src/adt/repository-reader.ts`
- Create: `src/cache/source-cache.ts`
- Create: `src/tools/read/repository-tools.ts`
- Test: `tests/unit/source-cache.test.ts`
- Test: `tests/mcp/repository-tools.test.ts`

- [ ] **Step 1: Write failing source paging tests**

```ts
it("returns exact inclusive one-based source ranges from cache", () => {
  const cache = new SourceCache(10);
  cache.put("SAH", "/programs/ztest", "one\ntwo\nthree");
  expect(cache.readRange("SAH", "/programs/ztest", 2, 3)).toEqual({ fromLine: 2, toLine: 3, lines: ["two", "three"] });
});
```

- [ ] **Step 2: Implement five repository tools**

Register:

```ts
export const REPOSITORY_TOOL_NAMES = [
  "search_repository_object",
  "read_source_code",
  "read_source_range",
  "get_object_structure",
  "where_used"
] as const;
```

Use `AdtClient.getUtils()` for repository search, source reads, and where-used when its typed API covers the operation. Keep parsing adapters in `repository-reader.ts` so MCP response shapes do not depend on upstream library internals. Enforce configured source-line limits and URI prefixes returned by SAP search.

- [ ] **Step 3: Run fixture and MCP tests**

```powershell
npm.cmd run test -- tests/unit/source-cache.test.ts tests/mcp/repository-tools.test.ts
npm.cmd run typecheck
```

Expected: wildcard search, source paging, object structure, and semantically read-only where-used POST pass.

- [ ] **Step 4: Commit repository tools**

```powershell
git add src/adt/repository-reader.ts src/cache src/tools/read/repository-tools.ts tests/unit/source-cache.test.ts tests/mcp/repository-tools.test.ts
git commit -m "feat: add repository source and where used tools"
```

### Task 4: Add Table Structure and OpenSQL Read Tools

**Files:**
- Create: `src/adt/table-reader.ts`
- Create: `src/sql/validate-read-query.ts`
- Create: `src/tools/read/table-tools.ts`
- Test: `tests/unit/read-query.test.ts`
- Test: `tests/mcp/table-tools.test.ts`

- [ ] **Step 1: Write failing query safety tests**

```ts
const allowed = [
  "SELECT matnr, mtart FROM mara WHERE matnr = '1'",
  "SELECT a~matnr, b~bwkey FROM mara AS a INNER JOIN mbew AS b ON a~matnr = b~matnr WHERE b~bwkey = '1000'"
];
const blocked = [
  "UPDATE mara SET mtart = 'X'",
  "SELECT * FROM mara; DELETE FROM mara",
  "SELECT * FROM mara",
  "SELECT * FROM mara -- bypass"
];
for (const sql of allowed) it(`allows ${sql}`, () => expect(validateReadQuery(sql, 500).kind).toBe("select"));
for (const sql of blocked) it(`blocks ${sql}`, () => expect(() => validateReadQuery(sql, 500)).toThrow());
```

- [ ] **Step 2: Implement table tools with hard limits**

Register `read_table_structure` and `read_table`. The validator permits one SELECT only, rejects comments and statement separators, requires an explicit WHERE for configured large-table patterns, and injects or lowers `UP TO N ROWS` to at most 500. The response preserves column order and character identifiers as strings.

- [ ] **Step 3: Run tests**

```powershell
npm.cmd run test -- tests/unit/read-query.test.ts tests/mcp/table-tools.test.ts
```

Expected: unsafe SQL cases are rejected before any fixture request and valid joins return structured columns and rows.

- [ ] **Step 4: Commit table tools**

```powershell
git add src/adt/table-reader.ts src/sql src/tools/read/table-tools.ts tests/unit/read-query.test.ts tests/mcp/table-tools.test.ts
git commit -m "feat: add guarded adt table reads"
```

### Task 5: Add Runtime Diagnostic and Transport Tools

**Files:**
- Create: `src/adt/runtime-reader.ts`
- Create: `src/tools/read/runtime-tools.ts`
- Test: `tests/mcp/runtime-tools.test.ts`

- [ ] **Step 1: Write failing tool contract tests**

```ts
const expected = ["list_dumps", "read_dump_detail", "read_system_messages", "read_http_log", "list_transports"];
it("registers every runtime tool", async () => {
  const names = (await client.listTools()).tools.map(tool => tool.name);
  expect(expected.every(name => names.includes(name))).toBe(true);
});
```

- [ ] **Step 2: Implement five tools**

Use `AdtRuntimeClient.getDumps()`, `getSystemMessages()`, and `getGatewayErrorLog()` where stable APIs exist. Use `AdtClient.getRequest()` or a narrow ADT request for transport listing. Normalize timestamps to ISO-8601 and preserve SAP IDs/URIs for detail calls. Empty feeds return `{ count: 0, items: [] }`.

- [ ] **Step 3: Run tests**

```powershell
npm.cmd run test -- tests/mcp/runtime-tools.test.ts
npm.cmd run typecheck
```

Expected: all five tool contracts pass against sanitized feeds and empty-feed fixtures.

- [ ] **Step 4: Commit runtime tools**

```powershell
git add src/adt/runtime-reader.ts src/tools/read/runtime-tools.ts tests/mcp/runtime-tools.test.ts
git commit -m "feat: add dump gateway message and transport reads"
```

### Task 6: Add Composite Source Search

**Files:**
- Create: `src/tools/read/search-source.ts`
- Test: `tests/unit/search-source.test.ts`
- Test: `tests/mcp/search-source.test.ts`

- [ ] **Step 1: Write failing bounded-search tests**

```ts
it("stops at maxObjects and maxResults", async () => {
  const result = await searchSource(fakeRepository(50), { pattern: "BAPI", objectType: "ANY", maxObjects: 3, maxResults: 2 });
  expect(result.objectsScanned).toBe(3);
  expect(result.matches).toHaveLength(2);
  expect(result.truncated).toBe(true);
});
```

- [ ] **Step 2: Implement `search_source`**

Compile the user pattern once with case-insensitive RegExp, reject invalid patterns with `INVALID_REGEX`, call repository search, read no more than `maxObjects`, return exact one-based line numbers, and stop when `maxResults` is reached.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/search-source.test.ts tests/mcp/search-source.test.ts
git add src/tools/read/search-source.ts tests/unit/search-source.test.ts tests/mcp/search-source.test.ts
git commit -m "feat: add bounded source content search"
```

### Task 7: Verify All 16 Tools and Perform Live SAH Reads

**Files:**
- Create: `tests/mcp/tool-inventory.test.ts`
- Create: `scripts/live-read-smoke.ts`
- Create: `docs/verification/phase-2.md`

- [ ] **Step 1: Assert the exact inventory**

```ts
expect(toolNames.sort()).toEqual([
  "get_object_structure", "list_dumps", "list_systems", "list_transports",
  "read_dump_detail", "read_http_log", "read_source_code", "read_source_range",
  "read_system_messages", "read_table", "read_table_structure", "sap_system_info",
  "search_repository_object", "search_source", "set_active_systems", "where_used"
].sort());
```

- [ ] **Step 2: Run the local gate**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:mcp
```

Expected: all commands exit `0` and exact inventory passes.

- [ ] **Step 3: Run read-only SAH smoke checks**

With `LIVE_SAP=SAH`, run the script to call system info, search one known object, read one table structure, execute `SELECT bukrs, butxt FROM t001 WHERE bukrs = '1000'`, and list diagnostic feeds. The script must perform no semantic write and print one line per tool with `PASS`, `EMPTY`, or `SKIP_WITH_REASON`.

- [ ] **Step 4: Record and commit the gate**

```powershell
git add tests/mcp/tool-inventory.test.ts scripts/live-read-smoke.ts docs/verification/phase-2.md
git commit -m "test: verify read tool parity on sah"
```
