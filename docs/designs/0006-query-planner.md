# Access-pattern query planner

Describe scalar AND conditions, required returned fields, consistency and sort
order. The metadata-only planner compares base-table, GSI and LSI access paths.
It separates key conditions from post-read filters, checks key types, projection,
index status, sparse membership and consistency, and produces a lossless Query
preview. No plan executes automatically. Use in Items fills the existing query
editor for review and local saving. AWS request JSON and index-design proposals
can be exported, but no schema mutation is attached to the planner.

Sparse coverage cannot be assumed: an index with an unconstrained key absent from
the base key may omit otherwise matching items. The user must explicitly accept
indexed-items-only results before that plan becomes executable. Projection gaps
block GSI plans; LSI table-fetch overhead is explained. All-fields requests need
ALL projection. Multi-attribute native key schemas are detected and marked
unsupported by this classic partition/sort editor, rather than silently collapsed.

The suggested plan minimises residual filters, favouring the base table on ties.
This is not a cost optimiser: item sizes, key skew, traffic and write amplification
need workload evidence. The last executed read's Count, ScannedCount and capacity
provide measured page-level feedback. Single-table templates illustrate leftmost
prefixes, sparse membership, inverted lookups and tenant-scoped queues. They are
editable examples and do not assume the application's entity schema.

Index proposals are design JSON, not UpdateTable requests. Review names, capacity,
quotas, projection, key maintenance, data migration/backfill and traffic before
using the existing protected schema workflow. Queries can be saved with the
existing host-local saved-query mechanism. Account/region isolation stays intact.

Sources checked 2026-09-17:

- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.KeyConditionExpressions.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.FilterExpression.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html
- https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html
