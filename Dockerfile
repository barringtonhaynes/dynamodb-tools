# syntax=docker/dockerfile:1.4

FROM python:3.11 AS base

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY ./start.sh /start.sh
RUN chmod +x /start.sh

COPY ./app /app
WORKDIR /app/

COPY ./examples /examples

ENV PYTHONPATH=/app
ENV LOG_LEVEL=INFO
ENV DATA_PATH=/data
ENV DELETE_TABLES_ON_STARTUP=False
ENV PURGE_TABLES_ON_STARTUP=False
ENV CREATE_TABLES_ON_STARTUP=True
ENV UPDATE_TABLES_ON_STARTUP=True
ENV SEED_TABLES_ON_STARTUP=True
ENV DYNAMODB_ENDPOINT_URL=http://dynamodb:8000
ENV AWS_DEFAULT_REGION=us-east-1
ENV AWS_ACCESS_KEY_ID=MY_ACCESS_KEY_ID
ENV AWS_SECRET_ACCESS_KEY=MY_SECRET_ACCESS_KEY
ENV AWS_SESSION_TOKEN=""

VOLUME /data/create /data/update /data/seed /data/import

EXPOSE 80

CMD ["/start.sh"]

FROM base as development

COPY requirements-dev.txt /tmp/requirements-dev.txt
RUN pip install --no-cache-dir -r /tmp/requirements-dev.txt

ENV UVICORN_RELOAD=True

FROM development as dev-envs

RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends git tar
EOF

RUN <<EOF
useradd -s /bin/bash -m vscode
groupadd docker
usermod -aG docker vscode
EOF

FROM base AS production
