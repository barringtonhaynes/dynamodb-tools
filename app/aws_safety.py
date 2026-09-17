"""Single-request accident protection for live AWS writes (not authentication)."""
import hashlib
import json
import re
import secrets
import time

from botocore.exceptions import BotoCoreError, ClientError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import connection
from .config import settings

# Ephemeral, bounded, and only accessed on the request event loop.
challenges = {}
WAIT_SECONDS = 5
LIFETIME_SECONDS = 120


def needs_confirmation(method, path, body):
    if path.rstrip("/") == "/api/partiql" and method == "POST":
        return not re.match(r"^\s*SELECT\b", str(body.get("statement", "")), re.I)
    return not connection.read_request(method, path)


def describe(method, path, body):
    match = re.match(r"/(?:api/)?tables/([^/]+)", path)
    target = match.group(1) if match else "workspace"
    if path == "/api/tables":
        definition = body.get("definition")
        target = (
            str(definition.get("TableName", "new table"))
            if isinstance(definition, dict)
            else "new table"
        )
    actions = {
        "purge": "Purge every item",
        "delete-selected": "Delete selected items",
        "streams": "Change Streams",
        "ttl": "Change TTL",
        "imports": "Import data (may overwrite items)",
        "mounted": "Import mounted data (may overwrite items)",
        "items": "Delete item" if method == "DELETE" else "Write item",
    }
    action = actions.get(path.rsplit("/", 1)[-1])
    if path == "/api/partiql":
        return "Run PartiQL write", "statement", str(body.get("statement", ""))
    if not action:
        action = {"DELETE": "Delete table", "PATCH": "Change table schema"}.get(
            method, "Change AWS data"
        )
    return action, target, ""


async def protect(request):
    if settings.dynamodb_mode != "aws":
        return None
    raw = await request.body()
    try:
        body = json.loads(raw) if raw else {}
    except (ValueError, UnicodeDecodeError):
        body = {}
    if not isinstance(body, dict):
        body = {}
    if not needs_confirmation(request.method, request.url.path, body):
        return None
    if settings.is_read_only:
        return JSONResponse({"detail": connection.READ_ONLY_MESSAGE}, status_code=403)
    try:
        info = await run_in_threadpool(
            lambda: connection.connection_info(connection.client())
        )
    except (BotoCoreError, ClientError):
        return JSONResponse(
            {
                "detail": "Cannot verify the AWS account. No change was made. Check your sign-in."
            },
            status_code=503,
        )
    fingerprint = (
        connection.connection_revision,
        info["account"],
        info["region"],
        info["principal"],
        request.method,
        request.url.path,
        request.url.query,
        hashlib.sha256(raw).hexdigest(),
    )
    now = time.monotonic()
    for key, value in list(challenges.items()):
        if now >= value["expires"]:
            del challenges[key]
    token = request.headers.get("x-aws-challenge")
    if token:
        saved = challenges.get(token)
        if (
            not saved
            or saved["fingerprint"] != fingerprint
            or request.headers.get("x-aws-confirmation") != saved["phrase"]
        ):
            return JSONResponse(
                {
                    "detail": "AWS approval expired or does not match this change. Start again."
                },
                status_code=409,
            )
        if now < saved["ready"]:
            return JSONResponse(
                {
                    "detail": "Pause to review the AWS target before applying this change."
                },
                status_code=409,
            )
        del challenges[token]  # Consume before dispatch; never replay a write.
        return None
    action, target, statement = describe(request.method, request.url.path, body)
    phrase = f"APPLY {info['account']} {info['region']} {target}"
    token = secrets.token_urlsafe(32)
    if len(challenges) >= 128:
        del challenges[next(iter(challenges))]
    challenges[token] = {
        "fingerprint": fingerprint,
        "phrase": phrase,
        "ready": now + WAIT_SECONDS,
        "expires": now + LIFETIME_SECONDS,
    }
    return JSONResponse(
        {
            "detail": "This change affects real AWS data. Review and confirm this exact operation.",
            "awsConfirmation": {
                "token": token,
                "phrase": phrase,
                "account": info["account"],
                "region": info["region"],
                "target": target,
                "action": action,
                "statement": statement,
                "waitSeconds": WAIT_SECONDS,
                "expiresSeconds": LIFETIME_SECONDS,
            },
        },
        status_code=428,
    )
