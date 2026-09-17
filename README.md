# DynamoDB Tools

A small, considered workspace for DynamoDB Local. Browse and query tables, edit
items, preview imports, export data, and keep track of your changes—all from the
same container that creates and seeds your development tables.

The interface is served at **`/`**, interactive API documentation at **`/docs`**,
and the original automation endpoints remain available.

![The DynamoDB Tools table explorer](docs/console.png)

## Try it

```bash
git clone https://github.com/barringtonhaynes/dynamodb-tools.git
cd dynamodb-tools
docker compose up --build
```

Open **[localhost:8002](http://localhost:8002)**. The included `compose.yaml` starts
an isolated, in-memory DynamoDB Local instance and seeds the `notable_people`
example. **This demo's data is disposable and resets when DynamoDB stops.**

No AWS account or browser build step is needed. The runtime serves its own HTML,
CSS, JavaScript, and icons without external fonts, CDNs, or analytics.

## In the workspace

| Area | What you can do |
| --- | --- |
| Overview | Check connectivity, table counts, estimated item counts and storage, recent activity, and quick actions. |
| Tables | Find tables by name. Create one with a guided key form or a full DynamoDB schema. |
| Item explorer | Scan or query primary and secondary indexes, use sort-key comparisons or ranges, navigate pages, and filter the current page. |
| Saved queries | Save named scans and queries, reload them from the first page, rename or update them, and delete saved definitions. |
| Item editor | View, create, edit, duplicate, or delete items using typed DynamoDB JSON. Creating an item refuses to overwrite an existing key. |
| Imports | Drag in CSV, plain JSON, or DynamoDB JSON; validate the entire file and preview records before importing. Load files from mounted folders too. |
| Exports | Download a complete paginated table scan as DynamoDB JSON, preserving numbers, sets, nested values, and base64 binary data. |
| Schema | Inspect keys, indexes, capacity, and the complete table definition. Apply `UpdateTable` JSON to change capacity or manage global indexes. |
| Manage | Purge a table's items or delete the whole table, with exact-name confirmation. |
| Activity | Follow queued, running, completed, and failed operations. Shows up to 100 recent entries in the current server session. |
| Settings | Inspect endpoint, region, mounted path, and startup-task configuration. Change these through the container environment. |

The layout adapts to small screens. Forms have accessible labels, dialogs support
Escape, tabs support arrow keys, and `/` focuses the current table or page filter.
Saved queries persist in browser storage, scoped to the console origin, DynamoDB
endpoint, region, and table. They retain the index, exact key values, sort order,
page size, and page filter. They are not shared between browsers; clearing site
data removes them. Loading checks that the saved index and key schema still exist.

Long-running table changes and imports use a bounded, sequential background queue.

## Use with your existing DynamoDB container

Build a local image from this checkout:

```bash
docker build -t dynamodb-tools:local .
```

Add this service to the same Compose network as your DynamoDB Local service:

```yaml
services:
  dynamodb-tools:
    image: dynamodb-tools:local
    ports:
      - "127.0.0.1:8002:80"
    environment:
      DYNAMODB_ENDPOINT_URL: http://dynamodb:8000
      DATA_PATH: /data
    volumes:
      - ./dynamodb-data/create:/data/create:ro
      - ./dynamodb-data/update:/data/update:ro
      - ./dynamodb-data/seed:/data/seed:ro
      - ./dynamodb-data/load:/data/load:ro
    depends_on:
      - dynamodb
```

The console is intended for **trusted local development**. It has no login system;
keep its published port bound to localhost. Database credentials stay on the
server. Browser writes from a different origin are rejected.

### Mounted files

```text
data/
├── create/                       # CreateTable JSON schemas
│   └── notable_people.json
├── update/                       # UpdateTable JSON schemas
│   └── notable_people.json
├── seed/                         # Loaded during startup
│   └── notable_people/
│       └── people.csv
└── load/                         # Available for on-demand imports
    └── notable_people/
        └── scientists.dynamodb.json
```

Missing folders are treated as empty. Files are processed in filename order.
CSV and JSON data files are discovered; unrelated files and directories are
ignored. API file loads, including symlink targets, must stay within the selected
table's load folder. Uploaded files are processed in memory and are not saved to
the mounted folders.

### Supported formats

- **CSV:** the first row contains attribute names. Values are strings. Use JSON
  when a table has numeric or binary primary keys. UTF-8 files with a BOM work.
- **JSON:** an array of objects. Numbers are parsed as exact decimals on the server.
- **DynamoDB JSON:** an array of typed items in a `.dynamodb.json` file. Example:

```json
[
  {
    "pk": {"S": "person#ada"},
    "sk": {"S": "profile"},
    "name": {"S": "Ada Lovelace"},
    "score": {"N": "12.50"},
    "active": {"BOOL": true}
  }
]
```

The editor and export format use typed JSON so JavaScript never rounds DynamoDB's
high-precision numbers. For binary values, `B` and `BS` use base64 strings.
Every imported item must contain all table keys with matching types. Browser
imports are limited to **10 MB**; startup seeding can read larger local files.

### Operational behavior

- Startup tasks finish before the application accepts requests. Failures stop
  startup and are logged; importing the Python application does not touch tables.
- Creating an existing table is skipped during startup. An identical single-index
  creation update is skipped when the index is already active; other invalid
  updates fail visibly. Console table creation reports an existing table as a failure.
- Imports replace records with matching primary keys. They are **not transactions**:
  earlier batches may remain after a later failure. Correct the file before retrying.
- Item edits replace the displayed item. Primary keys cannot change during editing;
  duplicate the item with a new key instead. Concurrent edits use last-writer-wins.
- Item counts and sizes are DynamoDB estimates. Scans and exports are not snapshots
  of a table receiving concurrent writes. A failed streaming export may leave a
  partial file; Activity marks it as interrupted.
- Run **one application worker**. Queue state, activity history, and statistics are
  in memory and reset when the server restarts. Do not stop it during an active write.
- The `seeded` counter tracks successful files, not individual records.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `DATA_PATH` | `/data` | Root of the mounted file folders |
| `DELETE_TABLES_ON_STARTUP` | `False` | Delete all tables before other tasks |
| `PURGE_TABLES_ON_STARTUP` | `False` | Empty all tables before other tasks |
| `CREATE_TABLES_ON_STARTUP` | `True` | Apply schemas from `create/` |
| `UPDATE_TABLES_ON_STARTUP` | `True` | Apply schemas from `update/` |
| `SEED_TABLES_ON_STARTUP` | `True` | Load files from `seed/` |
| `DYNAMODB_ENDPOINT_URL` | `http://dynamodb:8000` | DynamoDB endpoint |
| `AWS_DEFAULT_REGION` | `us-east-1` in Docker | AWS region |
| `AWS_ACCESS_KEY_ID` | `localaccesskey` in Docker | Dummy local access key |
| `AWS_SECRET_ACCESS_KEY` | `localsecretkey` in Docker | Dummy local secret key |
| `AWS_SESSION_TOKEN` | Empty in Docker | Optional AWS session token |

Defaults for AWS credentials are set by the Dockerfile. Native Python development
uses boto3's usual credential configuration. DynamoDB Local requires an
alphanumeric access key; the included dummy values meet that requirement.

## API

See **`/docs`** for the full request schemas and try-it controls.

| Method and route | Purpose |
| --- | --- |
| `GET /health` | Startup status, file counters, and settings (legacy) |
| `GET /tables` | Table names (legacy) |
| `GET /tables/{name}/data` | Mounted file names (legacy) |
| `POST /tables/{name}/data/{file}` | Synchronous mounted-file import (legacy) |
| `GET /api/overview` | Connection, table metadata, counters, activity |
| `POST /api/tables` | Queue table creation using `definition` |
| `GET /api/tables/{name}` | Table description |
| `PATCH /api/tables/{name}` | Queue schema update using `definition` |
| `DELETE /api/tables/{name}` | Queue deletion; requires `confirmation` equal to the table name |
| `POST /api/tables/{name}/purge` | Queue purge; requires the same confirmation |
| `POST /api/tables/{name}/items/search` | Scan/query a page with an opaque continuation cursor |
| `POST /api/tables/{name}/items/get` | Fetch an item by typed `key` |
| `PUT /api/tables/{name}/items` | Create/edit a typed `item`; optionally provide `originalKey` |
| `DELETE /api/tables/{name}/items` | Delete by typed `key` |
| `GET /api/tables/{name}/files` | Mounted file metadata |
| `POST /api/tables/{name}/imports/preview` | Validate `filename` and `content`; preview five records |
| `POST /api/tables/{name}/imports` | Queue a validated file import |
| `POST /api/tables/{name}/imports/mounted` | Queue an import by mounted `filename` |
| `GET /api/tables/{name}/export` | Stream a DynamoDB JSON download |
| `GET /api/operations` | Current session's activity |
| `GET /api/operations/{id}` | Status of a queued operation |
| `GET /api/settings` | Read-only configuration |

Queued requests return **202** with an operation ID. Poll that operation to learn
whether it completed or failed; acceptance is not success. Invalid input returns
400/422, missing resources 404, item conflicts 409, and upstream failures 502/503.

## Development and tests

Python 3.11+ runs the application. Node.js is only needed for formatting and browser
tests, not for serving the interface.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
pre-commit run --all-files
```

Tests use Moto and dummy credentials, covering data formats, decimal precision,
binary/set round trips, pagination, query conditions, CRUD, file containment,
background operation failures, and startup behavior.

To run Python directly, start a disposable DynamoDB Local instance and set its
endpoint and dummy credentials:

```bash
export AWS_ACCESS_KEY_ID=localaccesskey
export AWS_SECRET_ACCESS_KEY=localsecretkey
export AWS_DEFAULT_REGION=us-east-1
export DYNAMODB_ENDPOINT_URL=http://127.0.0.1:8000
export DATA_PATH=./examples/basic
uvicorn app.main:app --host 127.0.0.1 --port 18200 --reload
```

For the browser suite, point at a console using **disposable DynamoDB Local**.
It creates a uniquely named test table and removes it afterwards. Screenshots and
accessibility reports are written to the ignored `test-results/` folder.

```bash
npm ci
npx playwright install chromium
npm run check
CONSOLE_TEST_URL=http://127.0.0.1:18200 npm run test:browser
```

Set `PLAYWRIGHT_CHANNEL=chrome` to test with an installed Chrome instead.
The suite exercises desktop/mobile layouts, keyboard behavior, WCAG accessibility
checks, table/item creation and editing, imports, pagination, filtering, range
queries, downloads, purge confirmation, and deletion.

Pull requests run Python tests, formatting, browser checks against DynamoDB Local,
and a runtime container build. Publishing the Docker image happens only after
checks pass on a push to `main`.
