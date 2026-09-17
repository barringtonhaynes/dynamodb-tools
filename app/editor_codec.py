"""Lossless conversions between the item editor's JSON representations."""
import json
from decimal import Decimal

from boto3.dynamodb.types import TypeSerializer

from .data_codec import attribute_from_wire


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate attribute name: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"{value} is not a valid JSON number")


def parse_editor_json(text, plain=False):
    try:
        return json.loads(
            text,
            parse_float=Decimal if plain else float,
            parse_int=Decimal if plain else int,
            parse_constant=reject_constant,
            object_pairs_hook=unique_object,
        )
    except json.JSONDecodeError as error:
        raise ValueError(
            f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}"
        ) from error
    except RecursionError as error:
        raise ValueError("JSON nesting is too deep") from error


def plain_attribute(value, previous, path):
    """Keep binary/set types at their existing paths; infer other JSON types."""
    kind = next(iter(previous), None) if isinstance(previous, dict) else None
    if kind in {"B", "SS", "NS", "BS"}:
        if kind == "B" and isinstance(value, str):
            return {kind: value}
        if kind in {"SS", "BS"} and isinstance(value, list):
            return {kind: value}
        if kind == "NS" and isinstance(value, list):
            if all(isinstance(item, Decimal) for item in value):
                return {kind: [str(item) for item in value]}
        raise ValueError(
            f"{path}: expected {kind}. Change this type in DynamoDB JSON or Attributes."
        )
    if isinstance(value, dict):
        hints = previous.get("M", {}) if kind == "M" else {}
        return {
            "M": {
                key: plain_attribute(item, hints.get(key), f"{path}.{key}")
                for key, item in value.items()
            }
        }
    if isinstance(value, list):
        hints = previous.get("L", []) if kind == "L" else []
        return {
            "L": [
                plain_attribute(
                    item, hints[i] if i < len(hints) else None, f"{path}[{i}]"
                )
                for i, item in enumerate(value)
            ]
        }
    try:
        return TypeSerializer().serialize(value)
    except ArithmeticError as error:
        raise ValueError(
            f"{path}: number exceeds DynamoDB's supported precision or range"
        ) from error


def validate_attribute(attribute, path):
    if isinstance(attribute, dict) and len(attribute) == 1:
        kind, value = next(iter(attribute.items()))
        if kind == "M" and isinstance(value, dict):
            for key, child in value.items():
                validate_attribute(child, f"{path}.{key}")
        elif kind == "L" and isinstance(value, list):
            for i, child in enumerate(value):
                validate_attribute(child, f"{path}[{i}]")
        elif kind in {"SS", "NS", "BS"} and isinstance(value, list):
            # DynamoDB rejects duplicate set members. Compare numeric values exactly.
            try:
                members = [Decimal(v) for v in value] if kind == "NS" else value
                if len(set(members)) != len(members):
                    raise ValueError(f"{path}: sets cannot contain duplicate values")
            except (TypeError, ArithmeticError) as error:
                raise ValueError(f"{path}: invalid {kind} set") from error
    try:
        attribute_from_wire(attribute)
    except (ValueError, TypeError, ArithmeticError) as error:
        raise ValueError(f"{path}: {error}") from error


def plain_json(item):
    """Render number tokens without a binary float round trip."""

    def container(opener, entries, closer, depth):
        if not entries:
            return opener + closer
        pad = "  " * (depth + 1)
        return (
            opener
            + "\n"
            + pad
            + (",\n" + pad).join(entries)
            + "\n"
            + "  " * depth
            + closer
        )

    def value(attribute, depth):
        kind, data = next(iter(attribute.items()))
        if kind == "N":
            return str(Decimal(data))
        if kind == "NS":
            return container("[", [str(Decimal(v)) for v in data], "]", depth)
        if kind == "M":
            return mapping(data, depth)
        if kind == "L":
            return container(
                "[", [value(child, depth + 1) for child in data], "]", depth
            )
        return json.dumps(None if kind == "NULL" else data, ensure_ascii=True)

    def mapping(attributes, depth):
        return container(
            "{",
            [
                json.dumps(key) + ": " + value(child, depth + 1)
                for key, child in attributes.items()
            ],
            "}",
            depth,
        )

    return mapping(item, 0)


def convert_item(text, view, previous=None):
    parsed = parse_editor_json(text, plain=view == "json")
    if not isinstance(parsed, dict) or not parsed:
        raise ValueError("An item must be a nonempty JSON object")
    try:
        for key, attribute in (previous or {}).items():
            validate_attribute(attribute, key)
        item = (
            {
                key: plain_attribute(value, (previous or {}).get(key), key)
                for key, value in parsed.items()
            }
            if view == "json"
            else parsed
        )
        for key, attribute in item.items():
            if not key:
                raise ValueError("Attribute names cannot be empty")
            validate_attribute(attribute, key)
        return {
            "item": item,
            "ddb": json.dumps(item, indent=2),
            "json": plain_json(item),
        }
    except RecursionError as error:
        raise ValueError("JSON nesting is too deep") from error
