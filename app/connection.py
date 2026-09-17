"""One explicit connection shared by every API, importer and background task."""
import os
import re
from uuid import uuid4

import boto3
from botocore.config import Config

from .config import settings

connection_revision = uuid4().hex

READ_OPERATIONS = {
    "ListTables",
    "DescribeTable",
    "GetItem",
    "BatchGetItem",
    "TransactGetItems",
    "Scan",
    "Query",
    "DescribeTimeToLive",
    "ListStreams",
    "DescribeStream",
    "GetShardIterator",
    "GetRecords",
    "GetCallerIdentity",
}
READ_ONLY_MESSAGE = (
    "This connection is read-only. Change the access mode in Settings "
    "to enable writes; AWS IAM permissions still apply."
)


def guard_operation(model, params, **kwargs):
    service_name = getattr(
        getattr(model, "service_model", None), "service_name", "dynamodb"
    )
    if not settings.is_read_only or service_name not in {"dynamodb", "dynamodbstreams"}:
        # Credential providers may call STS AssumeRole or SSO GetRoleCredentials.
        # This guard applies to database mutations, not authentication exchanges.
        return
    if model.name in READ_OPERATIONS:
        return
    if model.name == "ExecuteStatement" and re.match(
        r"^\s*SELECT\b", params.get("Statement", ""), re.I
    ):
        return
    raise PermissionError(READ_ONLY_MESSAGE)


def session(config=None):
    config = config or settings
    if config.dynamodb_mode == "aws":
        # Explicit profile selection prevents stray environment keys from overriding SSO.
        result = boto3.Session(
            **({"profile_name": config.aws_profile} if config.aws_profile else {}),
            **({"region_name": config.aws_region} if config.aws_region else {})
        )
    else:
        # Local mode never needs an AWS login or instance metadata credentials.
        result = boto3.Session(
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID") or "localaccesskey",
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
            or "localsecretkey",
            aws_session_token=os.getenv("AWS_SESSION_TOKEN") or None,
            region_name=config.aws_region
            or os.getenv("AWS_DEFAULT_REGION")
            or "us-east-1",
        )
    result.events.register("before-parameter-build", guard_operation)
    return result


def options(config=None):
    config = config or settings
    return {
        "endpoint_url": None
        if config.dynamodb_mode == "aws"
        else config.dynamodb_endpoint_url,
        "config": Config(
            connect_timeout=3,
            read_timeout=10,
            retries={"max_attempts": 2},
            # AWS mode resolves each service's regional endpoint, including Streams.
            ignore_configured_endpoint_urls=config.dynamodb_mode == "aws",
        ),
    }


def client(service="dynamodb", config=None):
    return session(config).client(service, **options(config))


def resource():
    return session().resource("dynamodb", **options())


def connection_info(dynamodb_client, config=None):
    config = config or settings
    identity = (
        client("sts", config).get_caller_identity()
        if config.dynamodb_mode == "aws"
        else {}
    )
    return {
        "id": connection_revision,
        "mode": config.dynamodb_mode,
        "endpoint": dynamodb_client.meta.endpoint_url,
        "region": dynamodb_client.meta.region_name,
        "account": identity.get("Account"),
        "principal": identity.get("Arn"),
        "profile": config.aws_profile,
        "readOnly": config.is_read_only,
    }


def read_request(method, path):
    if method in {"GET", "HEAD", "OPTIONS"}:
        return True
    if method == "PUT" and path in {"/api/connection", "/api/local/definition"}:
        return True
    if method != "POST":
        return False
    if path.rstrip("/") in {
        "/api/items/convert",
        "/api/partiql",
        "/api/connection/test",
    }:
        return True  # PartiQL SELECT is enforced at the SDK boundary.
    return bool(
        re.fullmatch(
            r"/api/tables/[^/]+/(items/(search|get)|imports/preview|model|query-plan|streams/records)/?",
            path,
        )
    )
