# MCP SAP ADT Local Design

## 1. Purpose

Build an independent, locally owned MCP server named `mcp-sap-adt-local` that connects AI clients to SAP AS ABAP systems through documented SAP ADT and OData HTTP(S) interfaces.

The project must:

- Reproduce the public behavior of the 16 read-only SAP tools currently used by the user, without copying proprietary implementation code.
- Add controlled creation, update, activation, and verification for Z/Y ABAP main programs.
- Add a generic framework for reading and changing master data through allowlisted standard SAP OData APIs.
- Support multiple configurable non-production SAP systems rather than hard-coding SAH Client 400.
- Run indefinitely without trials, machine IDs, activation codes, license servers, or remote authorization dependencies.
- Package the three user-provided SAP skills from the parent workspace.

The source will be released under the MIT License. The license grants permanent local use and redistribution rights and has no runtime enforcement mechanism.

The implementation will use the public MCP SDK and documented SAP protocols. It will not invoke, wrap, patch, reverse engineer, or depend on the installed proprietary `mcp-sap-assistant` package.

## 2. Scope

### 2.1 Read-only compatibility tools

The server will expose these 16 tools:

1. `list_systems`
2. `set_active_systems`
3. `sap_system_info`
4. `search_repository_object`
5. `read_source_code`
6. `read_source_range`
7. `get_object_structure`
8. `where_used`
9. `list_dumps`
10. `read_dump_detail`
11. `read_system_messages`
12. `read_table`
13. `read_table_structure`
14. `read_http_log`
15. `list_transports`
16. `search_source`

The proprietary `activate` tool is deliberately excluded.

### 2.2 Controlled ADT development tools

The server will add:

- `prepare_z_program_change`
- `apply_z_program_change`
- `verify_z_program`

The first release supports creating and updating Z/Y executable main programs, activating them, and verifying active state and source hash. It does not support deleting objects, modifying SAP standard objects, creating packages, releasing transports, or exposing a generic ADT write endpoint.

### 2.3 Generic business API tools

The server will add:

- `list_business_apis`
- `inspect_business_api`
- `read_business_entity`
- `prepare_business_change`
- `apply_business_change`
- `verify_business_change`

The generic framework supports any standard OData master-data API that is active in a configured SAP system and explicitly allowlisted. Initial functionality is not limited to cost centers, activity types, G/L accounts, or materials. An API can be enabled through configuration without changing TypeScript source code.

Objects without a suitable standard OData API are outside generic coverage. They require a separately reviewed adapter, such as an RFC/BAPI integration, and are not silently routed through ADT.

Generic HTTP DELETE is not exposed. A deletion indicator or business action may be used only when it is explicitly modeled and allowlisted for that standard API.

### 2.4 SAP skills

The distribution will include normalized copies of:

- `sap-code-to-fs`
- `sap-dump-diagnose`
- `sap-interface-diagnose`

Each skill will use a standard `SKILL.md` entry point. The code-to-FS references, templates configuration, and Word template asset will be retained. A CLI command named `install-skills` will install these resources into the current user's Codex skills directory without overwriting an existing skill unless an explicit overwrite option is supplied.

## 3. Architecture

The solution is one modular TypeScript MCP server running over stdio.

```text
AI client
    |
    | MCP stdio
    v
mcp-sap-adt-local
    |-- CLI and MCP tool registry
    |-- system registry and configuration validation
    |-- encrypted credential store
    |-- per-system access policy
    |-- ADT HTTP client and XML parsers
    |-- OData HTTP client and metadata model
    |-- two-phase change-plan engine
    |-- audit logger and redaction
    `-- packaged SAP skills
          |
          |-- /sap/bc/adt for repository and diagnostic operations
          `-- /sap/opu/odata for standard business APIs
```

Modules are isolated by responsibility. Read tools cannot obtain a write-capable transport. ADT development and OData business writes use separate policy checks and separate tool handlers even though they share system and credential configuration.

## 4. Project Layout

```text
mcp-sap-adt-local/
|-- src/
|   |-- cli/
|   |-- config/
|   |-- credentials/
|   |-- policy/
|   |-- adt/
|   |-- odata/
|   |-- change-plans/
|   |-- audit/
|   |-- tools/
|   |   |-- read/
|   |   |-- development/
|   |   `-- business/
|   `-- server.ts
|-- skills/
|   |-- sap-code-to-fs/
|   |-- sap-dump-diagnose/
|   `-- sap-interface-diagnose/
|-- config/
|   |-- systems.example.yaml
|   `-- business-apis.example.yaml
|-- tests/
|   |-- unit/
|   |-- contract/
|   |-- mcp/
|   `-- live/
|-- docs/
`-- package.json
```

## 5. Multi-System Configuration

No SAP system, host, client, user, package, transport, or business API is hard-coded.

```yaml
version: 1

systems:
  - id: SAH
    label: "SAH Client 400"
    kind: s4hana-op
    environment: non-production
    connection:
      protocol: https
      host: sap.example.com
      port: 44300
      client: "400"
      language: "1"
      serverTimezone: Asia/Shanghai
    auth:
      type: basic
      username: DEMO_USER
      credentialRef: SAH
    tls:
      mode: pinned
      fingerprintSha256: "A0:A1:A2:A3:A4:A5:A6:A7:A8:A9:AA:AB:AC:AD:AE:AF:B0:B1:B2:B3:B4:B5:B6:B7:B8:B9:BA:BB:BC:BD:BE:BF"
      allowExpired: true
    access:
      read: true
      adtDevelopmentWrite: true
      businessApiWrite: true
    development:
      objectNamePatterns: ["Z*", "Y*"]
      requireTransport: true
    businessApis:
      enabledProfiles: ["s4-core-masterdata-approved"]
    limits:
      requestTimeoutMs: 30000
      rateLimitPerMin: 60
      maxSourceLines: 5000
```

The example fingerprint is a syntactically valid non-secret sample. `trust-certificate` replaces it with the reviewed fingerprint for the target system. `s4-core-masterdata-approved` is an administrator-reviewed profile defined in `business-apis.yaml`; it is not a wildcard and enables only the services and fields listed in that profile.

`environment: production` is always read-only. Write flags on a production entry are rejected during configuration validation rather than ignored.

## 6. Credentials

The YAML configuration contains usernames or credential references but no passwords. The `login --system <id>` command prompts without echo and protects the credential with Windows DPAPI for the current Windows user. `logout` removes the encrypted credential. The server never prints or logs a password, authorization header, CSRF token, or session cookie.

The credential implementation is owned by this project and does not read or decrypt the proprietary package's credential file. Users enter each SAP password once for this server.

## 7. TLS Modes

Four TLS modes are supported:

| Mode | Validation | Read | Write |
| --- | --- | --- | --- |
| `strict` | Normal trust chain, validity, and hostname | Yes | Yes |
| `custom-ca` | Configured enterprise CA plus validity and hostname | Yes | Yes |
| `pinned` | Exact SHA-256 certificate fingerprint and hostname; expiry may be explicitly allowed | Yes | Non-production only |
| `insecure` | No certificate validation | Yes, with warning | No |

`trust-certificate --system <id>` connects without trusting the certificate, displays subject, issuer, hostnames, validity dates, and SHA-256 fingerprint, and requires explicit confirmation before writing the fingerprint to the configuration. This is a trust-on-first-use workflow. A later fingerprint change blocks the connection until the certificate is reviewed and trusted again.

SAH Client 400 will use `pinned` mode because its current certificate is expired. This preserves connectivity without accepting an arbitrary replacement certificate. Other customer systems select a TLS mode independently.

## 8. Read-Only Data Safety

`read_table` accepts only a single OpenSQL SELECT statement. The validator rejects comments, multiple statements, data-changing keywords, dynamic SQL constructs outside the supported grammar, and queries exceeding the configured limit. Results are capped at 500 rows. Large tables require a selective WHERE clause. No read tool receives an HTTP method or client capable of mutating SAP state, except the documented where-used POST request, which is semantically read-only.

Repository source caching for `read_source_range` is session-local and bounded. Search aggregation limits the number of repository objects and total matches.

## 9. Controlled Change Plans

Both ADT development and OData business writes use the same state model:

1. A `prepare` tool validates system policy and input.
2. It reads current SAP state and produces an exact before/after diff.
3. It creates an unguessable, in-memory plan ID bound to system, user, target, action, current hash or ETag, and requested content.
4. The plan expires after 10 minutes and is lost when the MCP process stops.
5. An `apply` tool requires both the plan ID and `approveWrite: true`.
6. Immediately before writing, the tool rechecks system policy and the current hash or ETag.
7. A mismatch rejects the write and requires a new plan.
8. After writing, the tool performs an independent read-back verification.
9. The result is recorded in the audit log.

An apply request performs one exact SAP mutation. Read operations may retry bounded transient failures. Write operations never retry automatically.

## 10. Z/Y Program Development

`prepare_z_program_change` accepts create or update, a Z/Y program name, local source path, package, transport request when required, and description. It performs local static checks and reads current repository state.

`apply_z_program_change` creates or updates only the prepared object, activates it through ADT, and stops on activation failure. It cannot substitute a different source path, package, transport, or object name at apply time.

`verify_z_program` reads the active object and verifies package, active state, and optional expected source hash.

The server rejects:

- Names outside configured Z/Y patterns.
- SAP standard objects.
- Deletes and renames.
- Package creation.
- Transport release.
- A transport belonging to a different system or user when SAP reports that mismatch.
- Write operations on production or insecure TLS connections.

## 11. Generic OData Business APIs

`business-apis.yaml` is an administrator-reviewed allowlist. Each API entry defines:

- SAP service root and version.
- Allowed systems or system capability tags.
- Entity sets.
- Entity keys.
- Allowed read, create, update, and action operations.
- Allowed mutable fields.
- Immutable fields.
- Sensitive fields for audit redaction.
- Verification read query.
- Optional concurrency behavior when the API does not provide ETags.

The server reads `$metadata` and verifies configured entities, keys, and field types before enabling an API. Unknown fields, unknown entities, unconfigured actions, arbitrary URLs, and arbitrary HTTP methods are rejected.

`prepare_business_change` converts the requested values according to metadata, reads the current entity for updates, and produces a typed diff. `apply_business_change` obtains a CSRF token and session cookies, submits one POST or PATCH with ETag protection when available, and never automatically retries. `verify_business_change` reads the entity again and compares the expected values.

Supporting all master data means supporting every active standard OData master-data API that has been explicitly allowlisted. It does not mean bypassing missing SAP services or authorization, or accepting arbitrary endpoints.

## 12. Audit and Privacy

Audit records are append-only local JSONL entries containing:

- Timestamp and generated operation ID.
- MCP tool name.
- SAP system ID and client.
- Authenticated SAP username.
- Target object, service, or entity key.
- Change-plan ID and action.
- Changed field names.
- Before and after hashes or redacted values according to policy.
- SAP status, message identifiers, and verification result.

Audit records exclude credentials, authentication headers, cookies, CSRF tokens, full ABAP source, and unredacted configured sensitive fields.

## 13. Error Handling

Errors use stable machine-readable codes plus concise Chinese messages and an actionable next step. HTTP and SAP errors retain non-secret evidence such as HTTP status, SAP message ID, message number, severity, request path, and affected object.

The server distinguishes:

- Network and DNS failures.
- TLS trust, expiry, hostname, and fingerprint failures.
- HTTP 401 authentication failures.
- HTTP 403 authorization failures.
- HTTP 404 path or service activation failures.
- HTTP 409/412 concurrency failures.
- HTTP 500 SAP application failures.
- Timeouts.
- ADT activation errors.
- OData business validation errors.

## 14. Testing Strategy

### 14.1 Unit tests

Unit tests cover configuration schemas, production write rejection, object-name policies, OpenSQL read-only validation, XML/JSON parsing, source paging, certificate fingerprint comparison, plan expiry, optimistic concurrency, API allowlists, typed OData diffs, audit redaction, and DPAPI boundaries.

### 14.2 Contract tests

Sanitized local ADT and OData fixtures exercise every HTTP client operation. Tests cover CSRF and cookie flows, metadata parsing, activation errors, expired pinned certificates, changed fingerprints, 401/403/404/500 responses, and timeouts.

### 14.3 MCP protocol tests

Tests start the compiled stdio server, list tools, validate schemas, activate a configured fixture system, and call each tool through MCP transport. Standard output is reserved for MCP messages; diagnostics go to standard error.

### 14.4 Live SAH acceptance

SAH Client 400 is an approved non-production development and test system. Live acceptance proceeds only after local tests pass:

1. Establish pinned-certificate connectivity.
2. Exercise representative operations across all 16 read tools; tools with no current SAP records must return an empty valid result rather than fail.
3. Prepare a Z/Y program change and display the exact diff.
4. After a separate explicit user approval, create or update one named test program, activate it, and verify its source hash.
5. Inspect active standard OData APIs and select a dedicated test master-data record and reversible field.
6. After a separate explicit user approval, change that field, read it back, restore the original value, and verify the restoration.

No live write is inferred from approval of this design document. Each live SAP change requires its own prepared plan and approval.

## 15. Installation and Migration

The package provides:

- `serve`
- `login --system <id>`
- `logout --system <id>`
- `list-systems`
- `doctor [--system <id>]`
- `trust-certificate --system <id>`
- `install-skills`
- `--version`
- `--help`

The new MCP server is registered under `mcp-sap-adt-local` and initially runs alongside the proprietary server. Existing configuration is not overwritten. The proprietary server is disabled only after the new server passes local and live acceptance.

The project ships a Chinese installation and operations manual, configuration examples, API allowlist guidance, certificate trust instructions, write-approval examples, and a migration checklist.

## 16. Delivery Phases

The implementation is split into independently testable phases:

1. Foundation: project, CLI, configuration, credentials, TLS, policy, audit, and MCP transport.
2. Read parity: all 16 read-only tools and live SAH read acceptance.
3. Controlled development: Z/Y prepare, apply, activation, and verification.
4. Business APIs: metadata discovery, allowlist, prepare/apply/verify, and one reversible SAH acceptance change.
5. Skills and migration: normalized skill packages, installer, Chinese manual, packaging, and parallel migration.

Each phase must pass unit, contract, type, lint, and applicable MCP/live verification before the next phase is considered complete.

## 17. Success Criteria

The project is accepted when:

- The compiled package starts as an MCP stdio server on Windows ARM64 with Node.js 20.18.1 or newer.
- All 16 read tools are listed and work against fixtures; representative live operations work against SAH.
- Multiple systems can be added through configuration without source changes.
- Production systems cannot be configured for writes.
- Expired SAH TLS is accepted only through a confirmed pinned fingerprint; certificate replacement is rejected.
- Z/Y changes require a fresh approved plan and are activated and verified on SAH.
- Any allowlisted active standard OData master-data API can be inspected and used without TypeScript changes.
- OData writes require a fresh approved plan and are read back after execution.
- No generic SAP table write, standard-object modification, generic HTTP endpoint, delete tool, or transport release exists.
- Skills install with standard entry points and required assets.
- The installation and Chinese operations documentation is sufficient to configure another customer's non-production SAP system.
- Tests, type checking, linting, package build, MCP protocol checks, and the agreed live acceptance checks pass.
- Source and runtime contain no trial expiry, activation code, machine ID, or remote licensing mechanism.
