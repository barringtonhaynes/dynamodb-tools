# DynamoDB Tools: retrospective implementation record

Recorded during the user-authorized Tessera backfill on 2026-09-17. This document
records the implemented design; it is not presented as a design written before
implementation. The source commits below are authoritative. All are on
`improve/reliability-and-tests` in draft PR #1, not a merged or published release.

## Architecture and behavior

DynamoDB Tools serves an accessible, responsive browser console and API from one
FastAPI process. Static HTML/CSS/JavaScript needs no frontend build. A bounded
sequential queue runs long operations; history belongs to the process session.
The common boto3 connection factory selects local endpoints or regional AWS
services and applies SDK-level read-only protection. HTTP controls reject stale
connections, cross-origin writes and unconfirmed AWS changes.

Item conversion preserves Decimal precision, binary values and sets across
DynamoDB JSON, standard JSON and attribute-table views. Optional JSON Schema
contracts are console checks. Table samples, sparse-index membership and byte
estimates are explicitly limited observations, not whole-table guarantees.

The UI includes filtered/indexed queries, saved definitions, Streams, TTL,
PartiQL, imports, exports, bulk actions and a collapsed AWS Danger zone. AWS
writes require a typed account/region/target phrase, five-second delay and a
single-use two-minute approval bound to the request and identity. Listing and
per-table metadata permissions are handled independently.

## Commit-to-card provenance

| Card | Implemented slice | Commit |
| --- | --- | --- |
| T2 | Data loading and startup reliability | 3d27dd7339729201284449c0b74ef15894ff4f10 |
| T3 | Accessible local console and workflows | 26c4c91fd4cccea8f17e872ab2f85f14002cd25a |
| T4 | Persistent saved queries | cbd148a2f0f8850ee02640324108d295ab7429ae |
| T5 | Lossless item editor views | 1f368331bee03ffcdcb5d3d595752cadbb45beec |
| T6 | Filters, Streams, TTL, PartiQL and bulk actions | 41bc0cde3f07a787281cf5686a9ef74725ae1008 |
| T7 | Compact shared icons | 433ba6be1e1bddb27e9490e4ab644ca384041603 |
| T8 | Single-table insights, sizing and schemas | 1519d62debd8c1444b76065f62beee1b5e9cfa85 |
| T9 | Configurable AWS connections | 96ed583db16798714033d1239e669d0c4dd918ec |
| T10 | Deliberate AWS write confirmations | c3310fcb98517dc23c13ed48aef182708d1b7a8e |
| T11 | Table selection with restricted permissions | 968c32236139b8f6815cf459ebf2b4067cc4dc44 |

## Verification and limits

The backfill reran the current Python suite at commit 968c322: 149 tests passed,
with two third-party deprecation warnings. JUnit is captured in
`test-results/tessera-backfill.xml`; Tessera carries parsed results. This is a
current regression run, not a claim of 149 tests at every historical commit.
The completed browser run in this task covered desktop/mobile accessibility,
CRUD, editors, queries and AWS fixtures; existing screenshots and axe reports
are in `test-results/`. Real AWS verification is still pending because the
attempted default-credential probe returned an invalid security token.

DynamoDB Local produced an internal SQLite error after adding a GSI to an
existing populated table. Tests with indexes defined at table creation passed.
No workaround that modifies the user's dataset was applied. The app remains a
trusted local, single-worker tool without multi-user authentication. Concurrent
edits are last-writer-wins and imports are not transactional.

## Related records

- ADR 0001: shared local console and backend
- ADR 0002: AWS identity and deliberate writes
- ADR 0003: exact data and honest observations
- T1: standalone app and VS Code extension, still in backlog
