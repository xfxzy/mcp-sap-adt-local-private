# Phase 3 Verification

- Local date: `2026-08-10` (Asia/Shanghai)
- Branch: `feature/full-implementation`
- Target for live preparation: `SAH`, client `400`
- Live write status: **executed once and independently verified**

## Implemented Tools

1. `prepare_z_program_change`
2. `apply_z_program_change`
3. `verify_z_program`

The implementation supports only configured Z/Y executable main programs. It does not expose delete, rename, package creation, transport release, arbitrary ADT URLs, or SAP standard-object writes.

## Automatic Gate

| Command | Result |
| --- | --- |
| `npm.cmd run test` | Exit `0`; 33 files, 117 tests passed |
| `npm.cmd run test:mcp` | Exit `0`; 8 files, 23 tests passed |
| `npm.cmd run typecheck` | Exit `0` |
| `npm.cmd run lint` | Exit `0`; 77 files checked |
| `npm.cmd run build` | Exit `0` |

The commands were run sequentially because concurrent Vitest processes can trigger random file-open errors on the Parallels shared folder. A standalone rerun confirmed all MCP tests pass.

Safety coverage includes:

- Production writes rejected.
- Insecure TLS remains read-only.
- Names outside configured Z/Y patterns rejected.
- Required package and transport enforced.
- Expired plans rejected.
- Plan bound to SAP system, SAP user, target, action, package, transport, and normalized source hash.
- SAP source or package changes after prepare rejected before writing.
- `approveWrite` must be literal `true`.
- Applied plans consumed once, including failed concurrency checks.
- Create/update writes are never retried automatically.
- Activation and independent active-source/package/hash read-back required.
- Delete and transport-release tools absent from the MCP inventory.

## Live SAH Preparation and Apply

Read-only discovery found these modifiable Workbench objects for user `DEMO_USER`:

- Request: `DEMO900001` (`TRFUNCTION=K`, `TRSTATUS=D`)
- User task: `DEMO900002` (`TRFUNCTION=S`, `TRSTATUS=D`)
- Existing transportable package used by this user: `ZDEMO_USER`

The approved create plan returned:

| Field | Value |
| --- | --- |
| Plan ID | `67762f74-4295-4e42-a7b5-6815987c44ec` |
| Action | `create` |
| Program | `ZR_MCP_ADT_LOCAL_SMOKE` |
| Package | `ZDEMO_USER` |
| Transport request | `DEMO900001` |
| SAP user | `DEMO_USER` |
| Source SHA-256 | `ed4c04e6d79a17e9dc87f345a944f2ed9096bf30b947bdbf6d7a9b7fea8d49d4` |
| Result | `PREPARE_ONLY: PASS`, `SAP_WRITE_EXECUTED: NO` |

The approved apply used a fresh plan `63bd14c6-47f0-4b5e-8b12-2fbf155a8918` in the same process. The TLS fix disabled session resumption for pinned connections, preserving hostname and exact fingerprint checks. SAP created and activated the program, but the first post-write verification reported a hash mismatch because ADT removed the final source line ending. No second SAP write was attempted.

A subsequent read-only prepare confirmed the object now exists and is an update target (`8bdbccf8-fe33-4eec-a9ec-8275ca5e0faa`), with current and expected canonical hashes both `c20edd...`.

Source hashing now canonicalizes CRLF to LF and removes one final LF, matching SAP ADT serialization. The raw local-file hash approved before the write was `ed4c04e6d79a17e9dc87f345a944f2ed9096bf30b947bdbf6d7a9b7fea8d49d4`; the canonical/read-back hash is `c20edd561b7719e4516a8171052aa6024a85659c4474e304b4068338dd11a64a`.

An independent read-only `verify_z_program` call then returned:

| Field | Value |
| --- | --- |
| Program | `ZR_MCP_ADT_LOCAL_SMOKE` |
| Package | `ZDEMO_USER` |
| Active | `true` |
| Source hash | `c20edd561b7719e4516a8171052aa6024a85659c4474e304b4068338dd11a64a` |
| Hash matches | `true` |

Final SAP state: the approved program is created, active, assigned to package `ZDEMO_USER`, and recorded in task `DEMO900002` under Workbench request `DEMO900001`.
