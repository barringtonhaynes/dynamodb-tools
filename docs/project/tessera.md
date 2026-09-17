# Tessera project setup

Project `dynamodb-tools` lives in the personal `barringtonhaynes` tenant. The code
repository's `.tessera/config.toml` points to that board and enables every current
optional module: roster, agent-memory, safety, flow-steward, architecture,
roadmap, workspace, observability and patterns. Core cards, requirements,
decisions, risks, prompts, evidence and feature maps are available as well.

Board records are changed through Tessera MCP tools, never by editing board files.
Project configuration and repository documentation are versioned normally.
Flow-steward and workspace refresh are on-demand; enabling them does not start
background jobs. Patterns are enabled for discovery but none have been adopted.
No historical token counts or costs are invented.

T1 is the confirmed standalone-app and VS Code-extension follow-up. T2–T11 are
retrospective records of implemented, tested commits. Their board timestamps are
capture times, not original development dates. Source commits retain actual dates.
Done means implementation complete on the draft PR branch, not merged or released.
See [implementation provenance](../designs/0001-console-retrospective.md).

## Working agreement

Read the board and project context before starting work. Record and link the
prompt, add a design for user-visible changes, and attach evidence before closing.
Keep tests appropriate to the change; the standard checks are `pytest`,
`npm run check`, and configured pre-commit hooks. Run browser checks for UI changes
against a disposable DynamoDB Local environment. Keep secrets out of artifacts.
Use explicit user approval for publishing or changes outside the requested scope.

The recorded principles reflect user instructions from this task: protect live
AWS data, use existing credentials, preserve types, expose limits and keep the
local interface useful and accessible. Platform/framework choices for T1 remain
open. Live AWS verification and the DynamoDB Local GSI issue remain tracked risks.

## Setup health and limitations

The initial registration placed a flat board entry inside the personal tenant
directory. Tessera reports this as `flat-shadows-tenant`; mediated board operations
work, but registration cleanup remains outstanding. Automatic approval review
rejected a temporary registry repoint because it could disrupt board resolution.
Do not repair the nested Git layout while another Tessera process holds a
Git-enabled board store open. Use a reviewed maintenance procedure with a backup
and explicit approval before changing that registration.

The current design-reference hook checks paths against the board directory and
its parent, rather than the separately registered code repository. It therefore
warns about the relative design references used here even though the documents
exist under this repository's `docs/designs/`. The references are kept portable;
the documents were checked directly during the backfill.
