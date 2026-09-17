# T16 — Access-pattern query planner verification

Verified 2026-09-17 on Apple Silicon macOS, Python 3.11 and installed Chrome,
using DynamoDB Local at port 18100 and an isolated console at port 18201.
No live AWS data or schema was changed. Version 0.4.0 includes the planner in
browser, standalone desktop and the VS Code native table explorer.

## Evidence

- All 173 Python tests pass, including 17 planner cases: key/filter separation,
  sparse coverage, projection, consistency, status, ordering, key types and size,
  lossless numeric/binary values, literal name aliases, index proposal/reuse and
  read-only endpoint enforcement. The mocked AWS endpoint calls DescribeTable
  only; no Query, Scan or schema-write call occurs during planning.
- All 7 host/navigation tests pass with the frozen 0.4.0 service, including
  persistence, authentication, owned shutdown, cancellation and parent crashes.
- Frontend syntax/format checks and all configured pre-commit checks pass.
- `tests/browser/query-planner.mjs` passes: direct planner route performs no item
  reads; comparison/export and preparing Items also perform no reads; explicit
  primary and saved GSI queries return the expected local fixture. The test covers
  missing projection, strong-consistency rejection, explicit sparse acceptance,
  index-design reuse, JSON export, measured read feedback and query persistence.
  Desktop and mobile axe checks report zero WCAG 2 A/AA / 2.1 AA violations, and
  mobile has no horizontal page overflow. Test tables are removed afterwards.
- The complete pre-existing console browser regression passes, including item and
  table CRUD, filters, projections, Streams, TTL, PartiQL, imports/exports,
  pagination, saved queries and destructive-operation confirmation.
- The actual 0.4.0 VSIX was installed into a disposable profile. Native sidebar
  planner navigation, metadata comparison, accessible themed controls and
  prepare-without-read pass alongside existing persistence and draft checks.
- The packaged 0.4.0 Electron app passes planner comparison/prepare and
  accessibility checks alongside service authentication, restart persistence,
  workspace export/import and shutdown checks. It runs with an empty PATH.

Screenshots were inspected: `test-results/query-planner-desktop.png`,
`query-planner-mobile.png`, `vscode-query-planner.png` and
`desktop-query-planner.png`. Test reports and logs are retained locally; test
scripts are versioned and the planner browser check is included in CI.

## Boundaries

This is a structural advisor, not a cost estimator. Suggestions minimise residual
filters; they do not estimate selectivity, partition heat or workload savings.
Last-read counts/capacity describe one page. Single-table templates are editable
examples. Scalar AND conditions and classic partition/sort keys, including
composite strings, are supported. Native multi-attribute keys, OR and fan-out are
explicitly outside this builder. GSI proposals are design JSON, never automatic
UpdateTable calls. Live AWS and other operating systems were not newly verified
for this version. macOS preview builds use ad-hoc signing and are not notarized.

## Local artifacts

| Artifact | SHA-256 |
| --- | --- |
| `dynamodb-tools-0.4.0-darwin-arm64.vsix` | `8d2334fc6a34b9582ce767c3138b145b75e981962cfac0ca9206df3f75a33596` |
| `dynamodb-tools-0.4.0-mac-arm64.dmg` | `d74343574db119fed11ab790a70a836eb24cc2fb8e01aa2a425ec3bcac968f91` |
| `dynamodb-tools-0.4.0-mac-arm64.zip` | `44969c942c8c5b881cb6b9f7589d53bdeeeabf5bdcc211e3329cc693d085d97b` |
