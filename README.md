# DynamoDB Tools

[![pre-commit](https://img.shields.io/badge/pre--commit-enabled-brightgreen?logo=pre-commit)](https://github.com/pre-commit/pre-commit)

DynamoDB Tools is a utility container designed to run alongside docker-local in your
`docker-compose.yaml` file, depending on the environment variables set. This container can:

- Create any tables in the mounted `/data/create` folder
- Update any tables in the the mounted `/data/update` folder
- Seed any tables using the mounted `/data/seed` folder
- Import data from the mounted `/data/import` and `/data/seed` folders on request

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
    - [Import data](#import-data)
  - [DynamoDB Admin](#dynamodb-admin)
  - [Use with Docker Development Environments](#use-with-docker-development-environments)

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
      - ./dynamodb-data/import:/data/import
```

2. Run docker-compose up to start the containers.

#### Mounting the example files

To test the container and make sure everything works, set the `DATA_PATH` environment variable to `/examples/simple`.

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
| AWS_ACCESS_KEY_ID        | MY_ACCESS_KEY_ID     | The AWS access key ID       |
| AWS_SECRET_ACCESS_KEY    | MY_SECRET_ACCESS_KEY | The AWS secret access key   |
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

### Import data

> **Note**
> Although the functionality to import data through a UI is currently not implemented, the API can be accessed at http://localhost:8002/docs or http://localhost:8002/redoc. These endpoints allow you to monitor the health of the container, view the status of the imported data, list and import data from the mounted /data/import and /data/seed folders.

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
      - AWS_ACCESS_KEY_ID=MY_ACCESS_KEY_ID
      - AWS_SECRET_ACCESS_KEY=MY_SECRET_ACCESS_KEY
    depends_on:
      - dynamodb
```

## Use with Docker Development Environments

You can open this project in the Dev Environments feature of Docker Desktop version 4.12 or later.

[Open in Docker Dev Environments <img src="open_in_new.svg" alt="Open in Docker Dev Environments" align="top"/>](https://open.docker.com/dashboard/dev-envs?url=https://github.com/barringtonhaynes/dynamodb-tools)

To start the server in the Dev Environment, run the following command in the terminal:

```bash
./start_dev
```

You can can set environment variables for you Dev Environment by using `export`, for example:

```bash
export LOG_LEVEL=DEBUG
./start_dev
```

Alternatively, you can prefix the `start_dev` command with the environment variable, for example:

```bash
LOG_LEVEL=DEBUG ./start_dev
```

> **Note**
> This feature is currently in beta. See  the [official documentation](https://docs.docker.com/desktop/dev-environments) for further information.
