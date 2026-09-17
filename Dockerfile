# syntax=docker/dockerfile:1.4

FROM python:3.11-slim AS builder

WORKDIR /app

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY ./app ./app
COPY ./examples /examples

ENV LOG_LEVEL=INFO
ENV DATA_PATH=/data
ENV DELETE_TABLES_ON_STARTUP=False
ENV PURGE_TABLES_ON_STARTUP=False
ENV CREATE_TABLES_ON_STARTUP=True
ENV UPDATE_TABLES_ON_STARTUP=True
ENV SEED_TABLES_ON_STARTUP=True
ENV DYNAMODB_ENDPOINT_URL=http://dynamodb:8000
EXPOSE 80
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80", "--workers", "1"]

VOLUME /data/create /data/update /data/seed /data/load

FROM builder as dev-envs

RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends git
EOF

RUN <<EOF
useradd -s /bin/bash -m vscode
groupadd docker
usermod -aG docker vscode
EOF

# install Docker tools (cli, buildx, compose)
COPY --from=gloursdocker/docker / /

# Keep development tools out of the published default image.
FROM builder AS runtime
