# T17 — Filtered copies and transformations

Verified 2026-09-17 on Apple Silicon macOS. Version 0.5.0 adds Copy data to
browser, desktop and the native VS Code sidebar. No live AWS data was changed.

## Checks

- 195 Python tests pass (22 new copy cases): exact numeric/binary/set preservation,
  ordered remove/rename/set/timestamp transforms, frozen timestamps, full-item
  hydration for projections and GSI queries, bounded capture and continuation,
  empty filtered pages, destination key validation, numeric-key duplicates,
  conditional collision handling, explicit replacement, one-use previews,
  schema/connection invalidation, memory cap, expiry/discard, partial failures,
  queued/running cancellation and preventing connection changes during a copy.
- Cross-region transfer passes with mocked DynamoDB: a staged source survives a
  connection switch, writes arrive in the other region, and the source remains
  unchanged. Live cross-account verification is not claimed.
- AWS mode tests require read-write access, verified destination account/region,
  exact typed approval and the existing delay before dispatching copy writes.
- 7 host/navigation/frozen-service tests pass, including capability authentication,
  cancellation, persistence and owned service shutdown.
- The browser copy scenario passes against DynamoDB Local: prepare a GSI prefix
  query in Items, capture complete records from a KEYS_ONLY index, remove a field,
  rename binary data, add a JSON value, stamp timestamps, export exact DynamoDB
  JSON, change connection access, preserve staging, block read-only execution,
  skip an existing item, explicitly replace it, and verify unchanged source data.
  Capped capture exposes partial selection and prepares a continuation.
- Desktop/mobile copy screens have zero axe WCAG 2 A/AA and 2.1 AA violations;
  mobile has no horizontal overflow. The full existing console browser regression
  also passes (CRUD, imports/exports, saved queries, filtering, Streams, TTL,
  PartiQL, pagination and destructive confirmations).
- The actual 0.5.0 VSIX was installed into a disposable profile and passed native
  Copy data navigation, read-only capture and themed accessibility checks alongside
  the existing planner, draft protection, persistence and cold-start checks.
- The packaged Electron app passed Copy data capture/rendering and accessibility
  checks alongside the existing service authentication, persistence, export/import,
  planner and shutdown checks. It runs with an empty PATH.
- Frontend syntax/formatting and all configured pre-commit checks pass.

Screenshots inspected: `test-results/copy-data-desktop.png`,
`copy-data-mobile.png`, `desktop-copy-data.png`, `vscode-copy-data.png`.
Repeatable scripts are versioned; the copy browser check is included in CI.

## Deliberate limits

Capture is capped at 1,000 matched items, 20 pages and 10 MiB transformed data;
defaults are 100 items and 10 pages. Four immutable batches fit in transient
service memory and expire after 30 minutes or restart. Export files are explicit
user downloads, not automatic persistence. Destination previews expire after
five minutes and can execute once. Transformations affect literal top-level
attributes and use a capture-time timestamp. Reads are not snapshots. Full-item
hydration adds GetItem permission and read cost. Copies are sequential conditional
PutItem or explicitly replacing PutItem operations, not transactions or replication.
Earlier writes remain after a stop/failure; a failed request may have written.
Reported WCU comes from successful writes; failed conditions may also cost capacity.
No schema changes or live AWS integration verification were performed.

macOS preview artifacts are ad-hoc signed, not notarized. Other platform builds
and interactive installation were not newly verified in this local run.

## Local artifacts

| Artifact | SHA-256 |
| --- | --- |
| `dynamodb-tools-0.5.0-darwin-arm64.vsix` | `52e78625ffc47f0b213fd24f2d1c78bb9779f1b97bbc929a2a41e10012df5197` |
| `dynamodb-tools-0.5.0-mac-arm64.dmg` | `d7c0143c12137bc97b92645dcee852c8c41db759dabf3379604017fb1c7535fe` |
| `dynamodb-tools-0.5.0-mac-arm64.zip` | `4f3e9a7227a2bdf06ba1b3cc673af9a9c82c4cecae2824b3ba94a734e8ebb32e` |
