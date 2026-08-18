# Phase 4 Business OData Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement generic read, prepare, apply, and verify workflows for any active standard SAP OData master-data API explicitly enabled through an administrator-reviewed allowlist.

**Architecture:** A separate OData session shares system credentials and TLS policy but not ADT clients. Metadata is parsed into a typed service model; every path, entity, operation, key, action, and mutable field must be authorized by `business-apis.yaml` before any network write.

**Tech Stack:** Undici, fast-xml-parser, Zod, YAML, ETag/CSRF/cookie handling, Vitest.

---

### Task 1: Define and Validate the Business API Allowlist

**Files:**
- Create: `src/business-api/schema.ts`
- Create: `src/business-api/load-business-apis.ts`
- Create: `config/business-apis.example.yaml`
- Test: `tests/unit/business-api-config.test.ts`

- [ ] **Step 1: Write failing allowlist tests**

```ts
const validProductProfile = {
  version: 1,
  profiles: {
    "s4-core-masterdata-approved": {
      services: [{
        id: "API_PRODUCT",
        serviceRoot: "/sap/opu/odata/sap/API_PRODUCT_SRV/",
        entities: [{
          entitySet: "A_Product",
          keys: ["Product"],
          operations: ["read", "create", "update"],
          mutableFields: ["ProductType", "BaseUnit", "ProductGroup"],
          immutableFields: ["Product"],
          sensitiveFields: [],
          verifyFields: ["Product", "ProductType", "BaseUnit", "ProductGroup"]
        }]
      }]
    }
  }
};

it("rejects arbitrary service roots", () => {
  expect(() => parseBusinessApis({ version: 1, profiles: { bad: { services: [{ id: "BAD", serviceRoot: "https://evil.example/api", entities: [] }] } } })).toThrow(/relative.*odata/i);
});

it("accepts explicit entity operations and fields", () => {
  const config = parseBusinessApis(validProductProfile);
  const entity = config.profiles["s4-core-masterdata-approved"].services[0].entities[0];
  expect(entity.operations).toEqual(["read", "create", "update"]);
  expect(entity.mutableFields).toContain("ProductGroup");
});
```

- [ ] **Step 2: Implement the schema**

Allow only relative roots matching `/sap/opu/odata/sap/[A-Z0-9_]+/`; reject `..`, query strings, fragments, credentials, hosts, wildcard entity names, wildcard mutable fields, generic DELETE, and unknown operations.

Use this exact example profile shape:

```yaml
version: 1
profiles:
  s4-core-masterdata-approved:
    services:
      - id: API_PRODUCT
        serviceRoot: /sap/opu/odata/sap/API_PRODUCT_SRV/
        entities:
          - entitySet: A_Product
            keys: [Product]
            operations: [read, create, update]
            mutableFields: [ProductType, BaseUnit, ProductGroup]
            immutableFields: [Product]
            sensitiveFields: []
            verifyFields: [Product, ProductType, BaseUnit, ProductGroup]
```

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/business-api-config.test.ts
git add src/business-api/schema.ts src/business-api/load-business-apis.ts config/business-apis.example.yaml tests/unit/business-api-config.test.ts
git commit -m "feat: validate business api allowlists"
```

### Task 2: Parse and Validate OData Metadata

**Files:**
- Create: `src/odata/metadata-types.ts`
- Create: `src/odata/parse-metadata.ts`
- Create: `src/odata/validate-service-profile.ts`
- Test: `tests/fixtures/odata/product-metadata.xml`
- Test: `tests/unit/odata-metadata.test.ts`

- [ ] **Step 1: Write failing metadata tests**

```ts
import { readFile } from "node:fs/promises";
const productMetadataXml = await readFile(new URL("../fixtures/odata/product-metadata.xml", import.meta.url), "utf8");

it("extracts entity keys, nullable state, and Edm types", () => {
  const model = parseODataMetadata(productMetadataXml);
  expect(model.entitySets.A_Product.entityType).toBe("API_PRODUCT_SRV.A_ProductType");
  expect(model.entityTypes["API_PRODUCT_SRV.A_ProductType"].keys).toEqual(["Product"]);
  expect(model.entityTypes["API_PRODUCT_SRV.A_ProductType"].properties.Product.type).toBe("Edm.String");
});

it("rejects an allowlisted field absent from live metadata", () => {
  expect(() => validateServiceProfile(profileWithUnknownField, model)).toThrow(/UnknownField/);
});
```

- [ ] **Step 2: Implement typed metadata parsing**

Support OData V2 CSDL entity sets, entity types, properties, keys, nullable flags, max lengths, precision, scale, and function imports/actions exposed by the service. Normalize XML namespaces without dropping qualified names.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/odata-metadata.test.ts
git add src/odata/metadata-types.ts src/odata/parse-metadata.ts src/odata/validate-service-profile.ts tests/fixtures/odata/product-metadata.xml tests/unit/odata-metadata.test.ts
git commit -m "feat: parse and validate odata metadata"
```

### Task 3: Add OData Session, Key Encoding, and CSRF

**Files:**
- Create: `src/odata/odata-session.ts`
- Create: `src/odata/odata-path.ts`
- Create: `src/odata/odata-values.ts`
- Test: `tests/unit/odata-path.test.ts`
- Test: `tests/contract/odata-session.test.ts`

- [ ] **Step 1: Write failing path and CSRF tests**

```ts
it("encodes a composite OData V2 key without accepting raw path text", () => {
  expect(entityPath("A_CostCenter", { ControllingArea: "1000", CostCenter: "1000-1001" }, keyTypes)).toBe("A_CostCenter(ControllingArea='1000',CostCenter='1000-1001')");
});

it("fetches CSRF and cookies before one PATCH", async () => {
  await session.patchEntity(request);
  expect(fixture.methods).toEqual(["GET", "PATCH"]);
  expect(fixture.patchHeaders["x-csrf-token"]).toBe("fixture-token");
  expect(fixture.patchHeaders.cookie).toContain("SAP_SESSIONID=");
});
```

- [ ] **Step 2: Implement safe OData requests**

Build paths only from configured service root, validated entity set, and typed key values. Convert `Edm.String`, `Edm.Boolean`, integer, decimal, date/time, and GUID values without evaluating input. Fetch CSRF using a GET with `x-csrf-token: Fetch`, persist response cookies, and send `If-Match` when an ETag exists. Never retry POST, PATCH, or action requests.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/odata-path.test.ts tests/contract/odata-session.test.ts
git add src/odata tests/unit/odata-path.test.ts tests/contract/odata-session.test.ts
git commit -m "feat: add csrf protected odata sessions"
```

### Task 4: Add Business API Discovery and Read Tools

**Files:**
- Create: `src/business-api/business-api-registry.ts`
- Create: `src/tools/business/read-business-tools.ts`
- Test: `tests/mcp/read-business-tools.test.ts`

- [ ] **Step 1: Write failing inventory and access tests**

```ts
it("lists only profiles enabled for the active system", async () => {
  const result = await call("list_business_apis", { systemId: "SAH" });
  expect(result.apis.map((api: { id: string }) => api.id)).toEqual(["API_PRODUCT"]);
});

it("blocks an unconfigured entity before making a request", async () => {
  await expect(call("read_business_entity", { systemId: "SAH", apiId: "API_PRODUCT", entitySet: "A_Secret", keys: { Product: "1" } })).rejects.toThrow(/not allowlisted/i);
  expect(fixture.requestCount).toBe(0);
});
```

- [ ] **Step 2: Implement three read tools**

Register `list_business_apis`, `inspect_business_api`, and `read_business_entity`. Inspection fetches and validates `$metadata`; reads accept typed keys plus an optional configured-field projection and never accept raw `$filter`, `$expand`, `$select`, or URL fragments from the caller.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/mcp/read-business-tools.test.ts
git add src/business-api/business-api-registry.ts src/tools/business/read-business-tools.ts tests/mcp/read-business-tools.test.ts
git commit -m "feat: expose allowlisted business api reads"
```

### Task 5: Prepare Typed Business Changes

**Files:**
- Create: `src/business-api/business-diff.ts`
- Create: `src/business-api/prepare-business-change.ts`
- Test: `tests/unit/business-diff.test.ts`
- Test: `tests/unit/prepare-business-change.test.ts`

- [ ] **Step 1: Write failing field and type tests**

```ts
it("rejects immutable and unknown fields", async () => {
  await expect(prepareBusinessChange(deps, request({ changes: { Product: "NEW", Unknown: "x" } }))).rejects.toThrow(/immutable|unknown/i);
});

it("returns a typed before and after diff", async () => {
  const plan = await prepareBusinessChange(deps, request({ changes: { ProductGroup: "DY02" } }));
  expect(plan.diff).toEqual([{ field: "ProductGroup", before: "DY01", after: "DY02", type: "Edm.String" }]);
  expect(plan.expectedEtag).toBe('W/"fixture-etag"');
});
```

- [ ] **Step 2: Implement preparation**

Support operations `create`, `update`, and a named allowlisted action. For update, read the current entity and ETag. Reject unchanged requests, nulls for non-nullable properties, string-length violations, numeric overflow, immutable fields, sensitive fields without explicit API configuration, and operations absent from the profile. Store the typed payload in a ten-minute business change plan.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/business-diff.test.ts tests/unit/prepare-business-change.test.ts
git add src/business-api/business-diff.ts src/business-api/prepare-business-change.ts tests/unit/business-diff.test.ts tests/unit/prepare-business-change.test.ts
git commit -m "feat: prepare typed business api changes"
```

### Task 6: Apply and Verify Business Changes

**Files:**
- Create: `src/business-api/apply-business-change.ts`
- Create: `src/business-api/verify-business-change.ts`
- Create: `src/tools/business/write-business-tools.ts`
- Test: `tests/unit/apply-business-change.test.ts`
- Test: `tests/mcp/write-business-tools.test.ts`

- [ ] **Step 1: Write failing approval and concurrency tests**

```ts
import { SapHttpError } from "../../src/http/errors.js";

it("does not write when approveWrite is false", async () => {
  await expect(applyBusinessChange(deps, { planId: "plan-1", approveWrite: false })).rejects.toThrow(/approval/i);
  expect(deps.session.patchEntity).not.toHaveBeenCalled();
});

it("surfaces 412 as a stale plan without retry", async () => {
  deps.session.patchEntity.mockRejectedValue(new SapHttpError(412, "Precondition Failed"));
  await expect(applyBusinessChange(deps, { planId: "plan-1", approveWrite: true })).rejects.toMatchObject({ code: "STALE_CHANGE_PLAN" });
  expect(deps.session.patchEntity).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Implement three write workflow tools**

Register `prepare_business_change`, `apply_business_change`, and `verify_business_change`. Apply consumes one plan, revalidates system/profile/metadata, submits one request, reads the entity back, compares configured verification fields, and writes a redacted audit event. If verification fails, report `WRITE_VERIFICATION_FAILED`; do not issue an automatic compensating write.

- [ ] **Step 3: Run tests and commit**

```powershell
npm.cmd run test -- tests/unit/apply-business-change.test.ts tests/mcp/write-business-tools.test.ts
npm.cmd run typecheck
git add src/business-api src/tools/business/write-business-tools.ts tests/unit/apply-business-change.test.ts tests/mcp/write-business-tools.test.ts
git commit -m "feat: apply and verify allowlisted business changes"
```

### Task 7: Discover SAH APIs and Run One Reversible Acceptance Change

**Files:**
- Create: `scripts/live-odata-discovery.ts`
- Create: `scripts/live-odata-smoke.ts`
- Create: `docs/verification/phase-4.md`

- [ ] **Step 1: Run the local gate**

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit `0`; no unallowlisted path reaches the fixture server; no write retry test observes more than one mutation request.

- [ ] **Step 2: Inspect SAH service metadata without writing**

Run discovery for configured candidate standard master-data services. Record active/inactive status and metadata compatibility. Add only an active service, exact entity, key, operations, fields, and sensitive-field policy to the SAH allowlist.

- [ ] **Step 3: Prepare a reversible test change and stop**

Select a dedicated non-production test entity and a non-key field whose original value can be restored. Run prepare and present system, API, entity keys, original value, requested value, ETag, and plan expiry. Do not apply without a fresh user approval of that exact plan.

- [ ] **Step 4: Apply, verify, restore, and verify restoration after approval**

Apply the approved plan once. Read back and verify. Prepare a second plan restoring the exact original value, present it, obtain a second explicit approval, apply once, and verify restoration.

- [ ] **Step 5: Record and commit evidence**

Record redacted IDs, fields, HTTP/SAP status, ETags, and verification results without credentials or sensitive values:

```powershell
git add scripts/live-odata-discovery.ts scripts/live-odata-smoke.ts docs/verification/phase-4.md
git commit -m "test: verify reversible business api change on sah"
```
