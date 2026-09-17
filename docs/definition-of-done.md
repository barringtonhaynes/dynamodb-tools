<!-- generated-not-maintained: this file is a shadow of Tessera's governance entities. Do NOT hand-edit — run `tessera govern sync --write` to regenerate. The entities/config are the source of truth (RFC 0009 § 4.8). -->

# Definition of Done

The bar a card clears to be legitimately `done` — enforced on the move to `done` by the **H-dod** gate, which is enforced but **waivable** with a recorded reason (RFC 0009 § 4.4).

## Default criteria

_Applied to every card-type unless overridden._

| # | Criterion | Requires | Owed evidence |
| --- | --- | --- | --- |
| 1 | Record the design or an explicitly retrospective implementation note | design_ref | — |
| 2 | Attach relevant verified test results and their scope | — | tests |
| 3 | Record measured outcomes, limitations, and delivery provenance | metrics | — |

## Category → owed evidence

A card satisfying a requirement of a given category owes the matching evidence kind in its metrics box before `done` (RFC 0009 § 4.6).

| Requirement category | Owed evidence kind |
| --- | --- |
| constraint | tests |
| functionality | tests |
| performance | benchmark |
| reliability | fault-injection |
| security | security-review |
| supportability | tests |
| usability | tests |
| visual_review | visual_review |
