# ADR 0003: exact data and honest observations

Status: accepted as a retrospective record of implemented behavior.

DynamoDB Tools preserves Decimal precision, sets and binary attributes when
converting among editor views. JSON Schema is an optional console contract,
not a database constraint. The Browser Console exposes sample-based single-table
and sparse-index insights, with estimated bytes separated from billed capacity.
Missing metadata, incomplete reads and permission restrictions remain visible.

Evidence: commits 1f36833 and 1519d62; app/editor_codec.py,
app/item_insights.py and app/model_insights.py.
