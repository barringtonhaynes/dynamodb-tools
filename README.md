# DynamoDB Tools

DynamoDB Tools is a utility container designed to run alongside DynamoDB Local in your
`docker-compose.yaml` file, depending on the environment variables set. This container can:

- Create any tables in the mounted `/data/create` folder
- Update any tables in the mounted `/data/update` folder
- Seed any tables using the mounted `/data/seed` folder
- Load files from the mounted `/data/load` folder into tables on request

## Table of Contents

- [DynamoDB Tools](#dynamodb-tools)
  - [Table of Contents](#table-of-contents)
  - [Usage](#usage)
    - [Getting Started](#getting-started)
      - [Prerequisites](#prerequisites)
      - [Installation](#installation)
      - [Mounting the example files](#mounting-the-example-files)
    - [Environment variables](#environment-variables)
    - [Create tables](#create-tables)
    - [Update tables](#update-tables)
    - [Seed tables](#seed-tables)
    - [Load data](#load-data)
  - [DynamoDB Admin](#dynamodb-admin)
  - [Development and testing](#development-and-testing)

## Usage

### Getting Started

#### Prerequisites

- Docker installed on your machine
- A docker-compose.yaml file

#### Installation

1. Add the dynamodb-tools container to your docker-compose.yaml file:

```yaml
version: "3.8"

services:
  myapp:
    ...
    depends_on:
      - dynamodb

  dynamodb:
    image: amazon/dynamodb-local:latest

  dynamodb-tools:
    image: barringtonhaynes/dynamodb-tools:latest
    ports:
      - "8002:80"
    environment:
      - PURGE_TABLES_ON_STARTUP=True
    depends_on:
      - dynamodb
    volumes:
      - ./dynamodb-data/create:/data/create
      - ./dynamodb-data/update:/data/update
      - ./dynamodb-data/seed:/data/seed
      - ./dynamodb-data/load:/data/load
```

2. Run `docker compose up` to start the containers.

#### Mounting the example files

To test the container and make sure everything works, set the `DATA_PATH` environment variable to `/examples/basic`.

### Environment variables

The following environment variables are available:

| Variable                 | Default              | Description                 |
| ------------------------ | -------------------- | --------------------------- |
| LOG_LEVEL                | INFO                 | The log level to use        |
| DATA_PATH                | /data                | The path to the data folder |
| DELETE_TABLES_ON_STARTUP | False                | Delete tables on startup    |
| PURGE_TABLES_ON_STARTUP  | False                | Purge tables on startup     |
| CREATE_TABLES_ON_STARTUP | True                 | Create tables on startup    |
| UPDATE_TABLES_ON_STARTUP | True                 | Update tables on startup    |
| SEED_TABLES_ON_STARTUP   | True                 | Seed tables on startup      |
| DYNAMODB_ENDPOINT_URL    | http://dynamodb:8000 | The DynamoDB endpoint URL   |
| AWS_DEFAULT_REGION       | us-east-1            | The AWS region              |
| AWS_ACCESS_KEY_ID        | localaccesskey     | The AWS access key ID       |
| AWS_SECRET_ACCESS_KEY    | localsecretkey | The AWS secret access key   |
| AWS_SESSION_TOKEN        | NULL                 | The AWS session token       |

> **Warning**
> AWS credentials are not recommended to be used in production. This container is
intended to be used in local development environments only.

### Create tables

Mount a volume to the container's `/data/create` path and add the DynamoDB create table JSON.
Although not enforced, it's recommended to use the table name as the file name.

### Update tables

Mount a volume to the container's `/data/update` path and add the DynamoDB update table JSON.
Although not enforced, it's recommended to use the table name as the file name.

### Seed tables

Mount a volume to the container's `/data/seed` path and under a folder named after the table,
add the seed data.

The seed data can be in the following formats:

- **CSV**: where each column name is the attribute name and the first row is the column names
- **DynamoDB JSON**: where each JSON object is in the DynamoDB JSON format and contains the table keys.
- **JSON**: an array of JSON objects, where each JSON object should contain the table keys.

The task will look for the following file extensions, respectively: *.csv*, *.dynamodb.json*, *.json*

### Load data

> **Note**
> Although the functionality to load data through a UI is currently not implemented, the API can be accessed at http://localhost:8002/docs or http://localhost:8002/redoc. These endpoints allow you to monitor the health of the container, view the status of the loaded data, list files in the mounted `/data/load` folder and load them into tables.

File support is the same as the seed data.

## DynamoDB Admin

If you require an interface to view and edit your DynamoDB tables, you can use the [DynamoDB Admin](https://hub.docker.com/r/aaronshaf/dynamodb-admin) container by adding the following to your `docker-compose.yaml` file:

```yaml
version: "3.8"

services:
  ...

  dynamodb-admin:
    image: aaronshaf/dynamodb-admin:latest
    ports:
      - "8001:8001"
    environment:
      - DYNAMO_ENDPOINT=http://dynamodb:8000
      - AWS_DEFAULT_REGION=us-east-1
      - AWS_ACCESS_KEY_ID=localaccesskey
      - AWS_SECRET_ACCESS_KEY=localsecretkey
    depends_on:
      - dynamodb
```

## Development and testing

Python 3.11 or later is required for local development:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
pre-commit run --all-files
```

Tests use an in-memory DynamoDB mock and dummy credentials; no AWS account is required.
They cover data formats, decimal precision, paginated purges, failure reporting,
file containment, application startup, and the supplied examples.

To run the examples with Docker:

```bash
docker compose -f compose-dev.yaml up --build
```

Open the API documentation at <http://localhost:8002/docs>.
The development image is selected explicitly by `compose-dev.yaml`; the default
Docker build produces the runtime image without Docker or Git development tools.

For local Python development, set the AWS environment variables listed above,
point `DYNAMODB_ENDPOINT_URL` at your local DynamoDB instance, set
`DATA_PATH=./examples/basic`, and run:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

Use one application worker, because startup actions and statistics are per process.
Startup actions finish before the API accepts requests. A failure is logged and
prevents startup; importing the application does not modify any tables.
Missing create, update, seed, or load directories are treated as empty.
Files are processed in filename order; only regular CSV and JSON data files are discovered.

Imports use batch writes, retry unprocessed items through boto3, preserve JSON decimal
values, and treat CSV values as strings. Every item must contain the table keys.
Repeated keys are overwritten by the last record. The `seeded` statistic counts
successfully loaded files, not individual records. Imports are not transactional:
a failed file may have written earlier batches, so correct the file before retrying.

The load API returns HTTP 404 for missing files or tables, 400 for invalid input,
and 502/503 for upstream DynamoDB failures. Files must stay inside the table's
load directory, including symlink targets.

Creating an existing table is skipped. An identical single-index creation update
is also skipped when that index is already active. Other invalid updates fail visibly
instead of being treated as successful.

Pull requests run tests, formatting checks, and a container build. Publishing the
Docker image happens only after those checks pass on a push to `main`.
