# Phase 4 Business OData Verification

This phase adds a separately configured OData V2 path for standard SAP business APIs. It is independent of ADT and reuses the same system credentials, TLS policy, rate limit, and audit destination.

## Safety gates

- `business-apis.yaml` is an administrator-reviewed allowlist. Service roots are relative `/sap/opu/odata/sap/.../` paths only.
- Metadata is fetched and checked before every read, prepare, apply, and verify operation.
- `prepare_business_change` only reads SAP. It returns system, API, entity, keys, typed before/after values, ETag, and a ten-minute expiry.
- `apply_business_change` accepts only `approveWrite: true`, consumes one plan, submits one mutation, then performs an independent read-back verification.
- A failed verification is reported as `WRITE_VERIFICATION_FAILED`; no automatic compensating write is attempted.
- A restore is a second prepare plan and requires a second explicit approval.

## Live discovery

Run `node scripts/live-odata-discovery.mjs`. The script only fetches `$metadata` and records compatible/incompatible services. It does not issue POST, PATCH, action, or delete requests.

Before adding a service to the live config, confirm the entity set, exact key order, operations, mutable fields, immutable keys, sensitive-field redaction policy, and verification fields from the returned metadata.

## Acceptance procedure

1. Run discovery for the target non-production system.
2. Add one dedicated test entity and one reversible non-key field to `business-apis.yaml`.
3. Run `prepare_business_change` and present the exact plan to the user.
4. Apply only after a fresh approval of that exact plan; verify the independent read-back.
5. Prepare a second plan restoring the original value and obtain a second approval.
6. Apply and verify the restore. Record redacted IDs, fields, HTTP/SAP statuses, ETags, and verification outcomes. Never record credentials.

No production system is writable: the system schema rejects production write access and the runtime policy enforces the same boundary.
