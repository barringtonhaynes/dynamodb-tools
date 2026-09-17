# Copy selected data between databases

A small, staged transfer workflow, not a replication or bulk-migration service.
Start from Items (including a saved query or planner-generated access pattern),
capture a bounded Query/Scan, transform top-level attributes, and review the exact
output. Staged items remain in service memory across connection changes for 30
minutes. They are not credentials, settings or saved-query definitions. Export
DynamoDB JSON for durable/offline transfer; service restarts discard staging.

The initial implementation reads up to 1,000 matches, 20 response pages and 10 MiB
per capture, with explicit continuation/incomplete status. Index/projection reads
hydrate complete base-table items before transformations. Missing/deleted items
are counted. Reads consume capacity and are not a transaction or snapshot.

Ordered transformations support remove, rename (refuse collisions), set a literal
standard JSON value parsed losslessly, and a fixed capture timestamp (UTC ISO,
epoch seconds or milliseconds). Names are literal top-level attributes, not paths.
No expressions, executable parsing, scripts or network access. Preserve all other
DynamoDB types. Validate every transformed item, size and duplicate destination key
before execution. Whole-item replacement is explicit; default skip-existing uses
conditional PutItem, not a check-then-write race or overwriting BatchWriteItem.

The destination is the active connection: switch in Settings and open Copy data.
No second credentials store or exception to SDK write guards. Destination preview
binds an immutable item batch, collision policy, table identity/schema, verified
account/region/principal and connection revision to a short-lived one-use token.
Revalidate before execution. Reject copying back into the same source table.
Existing server read-only and typed/delayed AWS confirmations apply to execution.

Copies run in the existing bounded operation queue with progress and a cooperative
stop action. Previous writes remain after cancellation/error; the failing request
may have an uncertain outcome. Surface counts and do not silently retry whole
transfers. Memory is bounded and expiry/discard invalidate unclaimed previews.
Connection changes remain blocked while a copy is queued/running.

Sources checked 2026-09-17:

- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
- https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
