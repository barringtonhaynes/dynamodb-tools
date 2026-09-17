"""DynamoDB JSON and import codecs shared by startup and the browser console."""
import base64
import binascii
import csv
import io
import json
from datetime import datetime
from decimal import Decimal

from boto3.dynamodb.types import TypeDeserializer, TypeSerializer


def to_wire(value):
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: to_wire(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_wire(item) for item in value]
    return value


def attribute_from_wire(attribute):
    if not isinstance(attribute, dict) or len(attribute) != 1:
        raise ValueError("Each DynamoDB attribute must have exactly one type")
    kind, value = next(iter(attribute.items()))
    if kind not in {"S", "N", "B", "BOOL", "NULL", "M", "L", "SS", "NS", "BS"}:
        raise ValueError(f"Unknown DynamoDB attribute type: {kind}")
    if kind in {"S", "N", "B"} and not isinstance(value, str):
        raise ValueError(f"{kind} values must be strings")
    if kind in {"BOOL", "NULL"} and not isinstance(value, bool):
        raise ValueError(f"{kind} values must be booleans")
    if kind == "NULL" and value is not True:
        raise ValueError("NULL must be true")
    if kind == "M" and not isinstance(value, dict):
        raise ValueError("M values must be objects")
    if kind in {"L", "SS", "NS", "BS"} and not isinstance(value, list):
        raise ValueError(f"{kind} values must be arrays")
    if kind in {"SS", "NS", "BS"} and (
        not value or any(not isinstance(v, str) for v in value)
    ):
        raise ValueError("Sets must be nonempty arrays of strings")
    try:
        if kind == "B":
            value = base64.b64decode(value, validate=True)
        elif kind == "BS":
            value = [base64.b64decode(item, validate=True) for item in value]
        elif kind == "M":
            value = {key: attribute_from_wire(item) for key, item in value.items()}
        elif kind == "L":
            value = [attribute_from_wire(item) for item in value]
        result = {kind: value}
        # Check number ranges and supported types before sending a write.
        TypeSerializer().serialize(TypeDeserializer().deserialize(result))
        return result
    except (TypeError, KeyError, binascii.Error, ArithmeticError) as error:
        raise ValueError("Invalid DynamoDB attribute value") from error


def item_from_wire(item):
    if not isinstance(item, dict) or not item:
        raise ValueError("An item must be a nonempty DynamoDB JSON object")
    return {key: attribute_from_wire(value) for key, value in item.items()}


def parse_import(filename, content):
    if filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(
            reader.fieldnames
        ):
            raise ValueError("CSV must have a header with unique column names")
        rows = list(reader)
        if any(
            None in row or any(value is None for value in row.values()) for row in rows
        ):
            raise ValueError("Every CSV row must match the header")
        return [{key: {"S": value} for key, value in row.items()} for row in rows]
    if not filename.endswith(".json"):
        raise ValueError("Choose a .csv, .json, or .dynamodb.json file")
    rows = json.loads(content, parse_float=Decimal)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("JSON files must contain an array of objects")
    if filename.endswith(".dynamodb.json"):
        return [item_from_wire(row) for row in rows]
    serializer = TypeSerializer()
    return [
        {key: serializer.serialize(value) for key, value in row.items()} for row in rows
    ]
