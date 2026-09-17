"""Item sizing and table-key checks, shared by reads, writes and the editor."""
import base64
import json
from decimal import Decimal
from fractions import Fraction

ITEM_LIMIT = 400 * 1024


def utf8(value):
    return len(value.encode("utf-8"))


def attribute_size(attribute):
    kind, value = next(iter(attribute.items()))
    if kind == "S":
        return utf8(value)
    if kind == "N":
        # Do not normalize with Decimal's default 28-digit context.
        digits = "".join(map(str, Decimal(value).as_tuple().digits)).strip("0") or "0"
        return (len(digits) + 1) // 2 + 1
    if kind == "B":
        return len(base64.b64decode(value, validate=True))
    if kind in {"NULL", "BOOL"}:
        return 1
    if kind == "M":
        return (
            3 + len(value) + sum(utf8(k) + attribute_size(v) for k, v in value.items())
        )
    if kind == "L":
        return 3 + len(value) + sum(attribute_size(v) for v in value)
    return sum(attribute_size({kind[0]: v}) for v in value)


def item_metrics(item):
    attributes = [
        {"name": key, "bytes": utf8(key) + attribute_size(value)}
        for key, value in item.items()
    ]
    size = sum(a["bytes"] for a in attributes)
    return {
        "estimatedBytes": size,
        "jsonBytes": utf8(json.dumps(item, ensure_ascii=False, separators=(",", ":"))),
        "limitBytes": ITEM_LIMIT,
        "attributes": sorted(attributes, key=lambda a: a["bytes"], reverse=True),
    }


def read_metrics(items):
    sizes = [item_metrics(item)["estimatedBytes"] for item in items]
    return {"itemBytes": sizes, "returnedBytes": sum(sizes)}


def key_errors(item, schema, types, required=False):
    errors = []
    for key in schema:
        name = key["AttributeName"]
        kind = types[name]
        if name not in item:
            if required:
                errors.append(f"{name}: required {kind} key is missing")
            continue
        if not isinstance(item[name], dict) or set(item[name]) != {kind}:
            errors.append(f"{name}: key must have type {kind}")
            continue
        if kind in {"S", "B"}:
            size = attribute_size(item[name])
            limit = 2048 if key["KeyType"] == "HASH" else 1024
            if not 1 <= size <= limit:
                errors.append(f"{name}: key must be 1–{limit} bytes, got {size}")
    return errors


def table_checks(item, table):
    types = {
        a["AttributeName"]: a["AttributeType"] for a in table["AttributeDefinitions"]
    }
    errors = key_errors(item, table["KeySchema"], types, required=True)
    indexes = []
    for index in table.get("GlobalSecondaryIndexes", []) + table.get(
        "LocalSecondaryIndexes", []
    ):
        invalid = key_errors(item, index["KeySchema"], types)
        missing = [
            k["AttributeName"]
            for k in index["KeySchema"]
            if k["AttributeName"] not in item
        ]
        errors.extend(f'{index["IndexName"]}: {error}' for error in invalid)
        indexes.append(
            {
                "name": index["IndexName"],
                "status": "invalid"
                if invalid
                else "excluded"
                if missing
                else "included",
                "missing": missing,
                "errors": invalid,
            }
        )
    return {"errors": list(dict.fromkeys(errors)), "indexes": indexes}


def check_contract(item, text):
    """Optional Draft 2020-12 schema for the lossless standard JSON representation.

    References are deliberately unsupported: validation never retrieves a URL.
    """
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError, ValidationError

    from .editor_codec import (
        parse_editor_json,
        plain_json,
        reject_constant,
        unique_object,
    )

    parse_editor_json(text)  # Give syntax and duplicate-key errors the editor wording.
    schema = json.loads(
        text,
        parse_float=Decimal,
        parse_constant=reject_constant,
        object_pairs_hook=unique_object,
    )
    if not isinstance(schema, (dict, bool)):
        raise ValueError("Item schema must be a JSON object or boolean")

    def check_refs(node):
        if isinstance(node, dict):
            if "$ref" in node or "$dynamicRef" in node:
                raise ValueError(
                    "Item schemas do not support references; inline the schema instead"
                )
            for value in node.values():
                check_refs(value)
        elif isinstance(node, list):
            for value in node:
                check_refs(value)

    check_refs(schema)
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as error:
        raise ValueError(f"Invalid item schema: {error.message}") from error
    # JSON numbers are Decimals so neither data nor bounds lose precision.
    checker = Draft202012Validator.TYPE_CHECKER.redefine(
        "integer",
        lambda checker, value: value == value.to_integral_value()
        if isinstance(value, Decimal)
        else type(value) is int,
    )
    from jsonschema.validators import extend

    def multiple_of(validator, divisor, value, schema):
        if validator.is_type(value, "number") and Fraction(value) % Fraction(divisor):
            yield ValidationError(f"{value} is not a multiple of {divisor}")

    validator = extend(
        Draft202012Validator,
        validators={"multipleOf": multiple_of},
        type_checker=checker,
    )(schema)
    errors = []
    for error in validator.iter_errors(parse_editor_json(plain_json(item), plain=True)):
        path = ".".join(map(str, error.absolute_path)) or "$"
        errors.append(f"{path}: {error.message}")
        if len(errors) == 20:
            break
    return errors
