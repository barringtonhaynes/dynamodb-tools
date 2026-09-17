# ADR 0001: shared local console and backend

Status: accepted as a retrospective record of the implemented system.

DynamoDB Tools keeps its browser console and API in one FastAPI application,
serves static assets without a frontend build, and uses a bounded sequential
operation queue. This preserves the original local import/startup utility while
providing table and item workflows. The Browser Console calls the FastAPI Backend;
the backend owns operations and database access. Run one worker. History is
session-scoped. Standalone and VS Code packaging remain future work (T1).

Evidence: commits 3d27dd7 and 26c4c91; README.md and app/main.py.
