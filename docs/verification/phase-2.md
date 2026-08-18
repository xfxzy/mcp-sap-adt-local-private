# Phase 2 Verification

- Timestamp: `2026-08-09T21:31:30+08:00`
- Node.js: `v24.19.0`
- Branch: `feature/full-implementation`
- Target: `SAH` (`sap.example.com:44300`, client `400`)
- Platform note: automated gates were run through a temporary `pushd` drive mapping because Vite does not handle the direct Parallels shared-folder alias correctly.

## Read-Only Tool Inventory

The public inventory contains exactly 16 tools:

1. `list_systems`
2. `set_active_systems`
3. `sap_system_info`
4. `search_repository_object`
5. `read_source_code`
6. `read_source_range`
7. `get_object_structure`
8. `where_used`
9. `read_table_structure`
10. `read_table`
11. `list_dumps`
12. `read_dump_detail`
13. `read_system_messages`
14. `read_http_log`
15. `list_transports`
16. `search_source`

## Automated Gate

| Command | Result |
| --- | --- |
| `npm.cmd run test` | Exit `0`; 26 files, 84 tests passed |
| `npm.cmd run typecheck` | Exit `0` |
| `npm.cmd run lint` | Exit `0`; 62 files checked |
| `npm.cmd run build` | Exit `0` |
| `npm.cmd run test:mcp` | Exit `0`; 7 files, 20 tests passed |

The inventory contract asserts the exact 16 names above. Contract coverage also verifies strict TLS rejection, exact expired-certificate pin acceptance, SAP client/language propagation, bounded read retry, and the absence of automatic semantic-write retry.

## SAH TLS Policy

- Mode: `pinned`
- Certificate status: expired, explicitly allowed for this configured non-production system
- SHA-256 fingerprint: `A0:A1:A2:A3:A4:A5:A6:A7:A8:A9:AA:AB:AC:AD:AE:AF:B0:B1:B2:B3:B4:B5:B6:B7:B8:B9:BA:BB:BC:BD:BE:BF`
- Security boundary: an expired certificate is accepted only when its exact configured fingerprint matches. Hostname mismatch, fingerprint mismatch, and insecure global TLS disablement remain rejected.

## Live SAH Read Smoke

The smoke script first asserted `readOnlyHint: true` for every network tool it invoked, activated only `SAH`, and produced:

```text
sap_system_info: PASS
search_repository_object: PASS
read_table_structure: PASS
read_table: PASS
list_dumps: PASS
read_system_messages: EMPTY
read_http_log: EMPTY
list_transports: EMPTY
```

`EMPTY` means the authenticated SAP endpoint was reached and parsed successfully but returned no entries. The table smoke executed the bounded query `SELECT bukrs, butxt FROM t001 WHERE bukrs = '1000'`.

## Write Boundary

No SAP create, update, activation, business API mutation, transport release, or other semantic write was executed during Phase 2. Live SAP writes remain outside automatic gates and require a fresh prepared change plan followed by separate user approval for that exact plan.
