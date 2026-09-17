"""Metadata-only access-pattern planning. Never executes reads or schema changes."""
import json
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .data_codec import attribute_from_wire


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attribute: str = Field(min_length=1, max_length=255)
    operator: Literal[
        "=",
        "<>",
        "<",
        "<=",
        ">",
        ">=",
        "begins_with",
        "between",
        "exists",
        "not_exists",
    ] = "="
    value: dict | None = None
    end: dict | None = None

    @model_validator(mode="after")
    def validate_value(self):
        if self.operator in {"exists", "not_exists"}:
            if self.value is not None or self.end is not None:
                raise ValueError("Existence conditions do not take values")
            return self
        if (
            not self.value
            or len(self.value) != 1
            or next(iter(self.value)) not in {"S", "N", "B"}
        ):
            raise ValueError(
                "Planner values must be a DynamoDB string, number or binary scalar"
            )
        kind = next(iter(self.value))
        attribute_from_wire(self.value)
        if len(json.dumps(self.value).encode()) > 8192:
            raise ValueError("Planner values must be at most 8 KiB")
        if self.operator == "begins_with" and kind == "N":
            raise ValueError("begins_with requires a string or binary value")
        if self.operator == "between":
            if not self.end or set(self.end) != {kind}:
                raise ValueError("A range end with the same type is required")
            lower = attribute_from_wire(self.value)[kind]
            upper = attribute_from_wire(self.end)[kind]
            if len(json.dumps(self.end).encode()) > 8192:
                raise ValueError("Planner values must be at most 8 KiB")
            if kind == "N":
                lower, upper = Decimal(lower), Decimal(upper)
            if lower > upper:
                raise ValueError("Range start must not exceed range end")
        elif self.end is not None:
            raise ValueError("Only BETWEEN takes a range end")
        return self


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conditions: list[Condition] = Field(min_length=1, max_length=20)
    projection: list[str] = Field(default_factory=list, max_length=100)
    consistent: bool = False
    allowSparse: bool = False
    ascending: bool = True
    orderBy: str = Field(default="", max_length=255)
    draftPartition: str = Field(default="", max_length=255)
    draftSort: str = Field(default="", max_length=255)

    @model_validator(mode="after")
    def unique_attributes(self):
        names = [rule.attribute for rule in self.conditions]
        if len(names) != len(set(names)):
            raise ValueError("Use one condition per attribute; use BETWEEN for a range")
        if any(not name or len(name) > 255 for name in self.projection):
            raise ValueError(
                "Returned attributes must be nonempty names up to 255 characters"
            )
        if self.draftPartition and self.draftPartition == self.draftSort:
            raise ValueError("Proposed partition and sort attributes must differ")
        return self


def key_error(rule, types, role):
    if not rule.value:
        return "A key condition needs a value"
    kind, value = next(iter(rule.value.items()))
    if rule.attribute in types and types[rule.attribute] != kind:
        return f"{rule.attribute} requires type {types[rule.attribute]}, not {kind}"
    raw = attribute_from_wire(rule.value)[kind]
    size = len(raw if kind == "B" else value.encode())
    if not size or size > (2048 if role == "HASH" else 1024):
        return f"{rule.attribute} has an empty or oversized key value"
    if rule.end:
        end_rule = Condition(attribute=rule.attribute, value=rule.end)
        return key_error(end_rule, types, role)
    return None


def aws_query(table, request, partition, sort, residual, index):
    names, values = {}, {}

    def expression(rule, prefix):
        alias, token = "#" + prefix, ":" + prefix
        names[alias] = rule.attribute
        if rule.operator in {"exists", "not_exists"}:
            return f"attribute_{rule.operator}({alias})"
        values[token] = rule.value
        if rule.operator == "begins_with":
            return f"begins_with({alias}, {token})"
        if rule.operator == "between":
            values[token + "end"] = rule.end
            return f"{alias} BETWEEN {token} AND {token}end"
        return f"{alias} {rule.operator} {token}"

    key_expression = expression(partition, "pk")
    if sort:
        key_expression += " AND " + expression(sort, "sk")
    result = {
        "TableName": table["TableName"],
        "KeyConditionExpression": key_expression,
        "ScanIndexForward": request.ascending,
        "ConsistentRead": request.consistent,
        "Limit": 25,
        "ReturnConsumedCapacity": "TOTAL",
    }
    if index:
        result["IndexName"] = index
    if residual:
        result["FilterExpression"] = " AND ".join(
            f"({expression(rule, f'f{i}')})" for i, rule in enumerate(residual)
        )
    if request.projection:
        projected = list(
            dict.fromkeys(
                request.projection
                + [key["AttributeName"] for key in table["KeySchema"]]
            )
        )
        for i, name in enumerate(projected):
            names[f"#p{i}"] = name
        result["ProjectionExpression"] = ", ".join(
            f"#p{i}" for i in range(len(projected))
        )
    result["ExpressionAttributeNames"] = names
    result["ExpressionAttributeValues"] = values
    return result


def candidate(table, definition, kind, request):
    rules = {rule.attribute: rule for rule in request.conditions}
    schema = definition["KeySchema"]
    hashes = [k["AttributeName"] for k in schema if k["KeyType"] == "HASH"]
    ranges = [k["AttributeName"] for k in schema if k["KeyType"] == "RANGE"]
    name = definition.get("IndexName")
    result = {
        "id": "index/" + name if name else "__table__",
        "name": name or "Base table",
        "kind": kind,
        "keys": schema,
        "blockers": [],
        "warnings": [],
        "keyConditions": [],
        "filterAttributes": [],
        "request": None,
        "awsRequest": None,
    }
    blockers, warnings = result["blockers"], result["warnings"]
    if len(hashes) != 1 or len(ranges) > 1:
        blockers.append(
            "Multi-attribute keys need the advanced AWS query API; this planner supports one partition and "
            "one sort attribute, including composite strings."
        )
        return result
    pk, sk = hashes[0], ranges[0] if ranges else None
    partition, sort = rules.get(pk), rules.get(sk)
    types = {
        a["AttributeName"]: a["AttributeType"] for a in table["AttributeDefinitions"]
    }
    if not partition or partition.operator != "=":
        blockers.append(
            f"Supply an equality condition on {pk} to use Query. Otherwise this access path needs a scan."
        )
    else:
        error = key_error(partition, types, "HASH")
        if error:
            blockers.append(error)
        result["keyConditions"].append(pk)
    if sort and sort.operator == "exists":
        sort = None  # Every entry already has the index sort key.
    elif sort and sort.operator in {"<>", "not_exists"}:
        blockers.append(
            f"{sk}: this condition cannot be a sort-key condition or a key filter in Query."
        )
    elif sort:
        error = key_error(sort, types, "RANGE")
        if error:
            blockers.append(error)
        result["keyConditions"].append(sk)
    residual = [rule for rule in request.conditions if rule.attribute not in {pk, sk}]
    result["filterAttributes"] = [rule.attribute for rule in residual]
    if residual:
        warnings.append(
            "Remaining conditions are post-read filters. They do not reduce the items evaluated or the read "
            "capacity consumed; pages can be empty and still have a continuation."
        )
    if request.orderBy and request.orderBy != sk:
        blockers.append(
            f"This access path orders by {sk or 'no sort key'}, not {request.orderBy}. "
            "DynamoDB cannot sort by an arbitrary attribute."
        )
    if kind == "GSI" and request.consistent:
        blockers.append(
            "GSIs support eventual consistency only. Use the base table or an LSI for a strongly consistent query."
        )
    if name and definition.get("IndexStatus", "ACTIVE") != "ACTIVE":
        blockers.append("This index is not ACTIVE; wait for it to become available.")
    if kind != "TABLE":
        base_keys = {k["AttributeName"] for k in table["KeySchema"]}
        index_keys = {k["AttributeName"] for k in schema}
        implied = {
            r.attribute for r in request.conditions if r.operator != "not_exists"
        }
        missing_presence = index_keys - base_keys - implied
        warnings.append(
            "Index membership requires every index key attribute to exist. Inspect the Data model sample to "
            "check observed eligibility; samples do not prove complete coverage."
        )
        if missing_presence and not request.allowSparse:
            blockers.append(
                "This index can omit matching items missing "
                + ", ".join(sorted(missing_presence))
                + ". Confirm indexed-items-only results to use this sparse access path."
            )
        projection = definition.get("Projection", {"ProjectionType": "ALL"})
        result["projection"] = projection["ProjectionType"]
        if projection["ProjectionType"] != "ALL":
            available = (
                base_keys | index_keys | set(projection.get("NonKeyAttributes", []))
            )
            needed = set(request.projection) | set(result["filterAttributes"])
            absent = sorted(needed - available)
            if not request.projection:
                blockers.append(
                    "Specify returned attributes: this index does not project every table attribute."
                )
            if absent and kind == "GSI":
                blockers.append(
                    "Not projected into this GSI: "
                    + ", ".join(absent)
                    + ". A GSI cannot fetch these from the base table."
                )
            elif absent:
                warnings.append(
                    "The LSI must fetch unprojected attributes from the base table, adding read cost and latency: "
                    + ", ".join(absent)
                )
        if kind == "GSI":
            warnings.append(
                "A GSI adds storage and write work, may lag the table, and can throttle table writes if its "
                "capacity is insufficient."
            )
    else:
        result["projection"] = "ALL"
    if not blockers:
        result["request"] = {
            "mode": "query",
            "index": name,
            "partition": partition.value,
            "sort": sort.value if sort else None,
            "sortEnd": sort.end if sort else None,
            "operator": sort.operator if sort else "=",
            "ascending": request.ascending,
            "limit": 25,
            "consistent": request.consistent,
            "projection": request.projection,
            "filters": [r.model_dump(exclude_none=True) for r in residual],
            "filterJoin": "AND",
        }
        result["awsRequest"] = aws_query(
            table, request, partition, sort, residual, name
        )
    return result


def proposed_index(table, request):
    if not request.draftPartition:
        return None
    rules = {r.attribute: r for r in request.conditions}
    pk, sk = rules.get(request.draftPartition), rules.get(request.draftSort)
    if not pk or pk.operator != "=":
        return {
            "blockers": ["Choose an equality condition for the proposed partition key."]
        }
    if request.draftSort and (not sk or not sk.value):
        return {"blockers": ["Add a typed condition for the proposed sort attribute."]}
    types = {
        a["AttributeName"]: a["AttributeType"] for a in table["AttributeDefinitions"]
    }
    errors = [
        error
        for rule, role in [(pk, "HASH"), (sk, "RANGE")]
        if rule
        for error in [key_error(rule, types, role)]
        if error
    ]
    if errors:
        return {"blockers": errors}
    schema = [{"AttributeName": pk.attribute, "KeyType": "HASH"}]
    if sk:
        schema.append({"AttributeName": sk.attribute, "KeyType": "RANGE"})
    included = sorted(
        (set(request.projection) | set(rules))
        - {k["AttributeName"] for k in table["KeySchema"] + schema}
    )
    projection = (
        {"ProjectionType": "ALL"}
        if not request.projection
        else {"ProjectionType": "INCLUDE", "NonKeyAttributes": included}
        if included
        else {"ProjectionType": "KEYS_ONLY"}
    )
    if projection["ProjectionType"] == "INCLUDE" and len(included) > 20:
        return {
            "blockers": [
                "More than 20 non-key attributes would need projection. Narrow the returned fields or explicitly "
                "choose all attributes."
            ]
        }
    return {
        "blockers": [],
        "definition": {
            "KeySchema": schema,
            "Projection": projection,
            "AttributeDefinitions": [
                {"AttributeName": r.attribute, "AttributeType": next(iter(r.value))}
                for r in [pk, sk]
                if r
            ],
        },
        "reuse": [
            i["IndexName"]
            for i in table.get("GlobalSecondaryIndexes", [])
            if i["KeySchema"] == schema
        ],
        "notes": [
            "Design proposal only. Choose an index name, capacity settings, quotas and a rollout/backfill "
            "plan before any schema change.",
            "Use high-cardinality partition values; a constant such as OPEN or one popular tenant can "
            "concentrate traffic. Sharding requires querying and merging multiple partitions.",
            "For a sparse index, write dedicated key attributes only on eligible items and remove them when "
            "eligibility ends. A value such as OPEN alone does not make an index sparse.",
            "Application writes must maintain synthetic keys. Existing items need a reviewed migration if "
            "those attributes are absent.",
            "Reuse existing indexes with suitable keys where possible; evaluate all access patterns and "
            "write volume before adding another index.",
            "Projection selection includes filter attributes. Check the aggregate INCLUDE-attribute quota "
            "across indexes, and compare storage/write overhead with measured reads.",
        ],
    }


def plan_access(table, request):
    candidates = [candidate(table, table, "TABLE", request)]
    for kind, field in [
        ("GSI", "GlobalSecondaryIndexes"),
        ("LSI", "LocalSecondaryIndexes"),
    ]:
        candidates.extend(
            candidate(table, index, kind, request) for index in table.get(field, [])
        )
    viable = sorted(
        (c for c in candidates if c["request"]),
        key=lambda c: (len(c["filterAttributes"]), c["kind"] != "TABLE", c["name"]),
    )
    return {
        "candidates": candidates,
        "suggested": viable[0]["id"] if viable else None,
        "basis": "Suggested plans have the fewest post-read filters; ties prefer the base table. This is "
        "a structural comparison, not a measured cost or latency prediction.",
        "proposal": proposed_index(table, request),
        "notes": [
            "Planning uses table metadata only. It does not scan items, execute a query or change indexes.",
            "Returned-attribute selection shrinks the response, not the read units for the same evaluated "
            "items. An index's stored projection can change its entry size and read cost.",
            "Composite string sort keys match from the left: ORDER#2026-09#... supports ORDER# and "
            "ORDER#2026-09 prefixes, not suffix searches. Use consistent UTC timestamps and zero-pad numeric "
            "string components.",
            "One query targets one partition value. Fan-out, multi-attribute native keys and OR conditions "
            "need a different query strategy; this builder never silently turns them into scans.",
        ],
    }
