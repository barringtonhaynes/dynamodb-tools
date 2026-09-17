"""Bounded single-table observations; never infer whole-table statistics."""
import json
from collections import Counter

from .item_insights import item_metrics, table_checks


def key_pattern(attribute, delimiter):
    if not attribute:
        return "—"
    kind, value = next(iter(attribute.items()))
    if kind != "S":
        return f"<{kind}>"
    parts = value.split(delimiter)
    return parts[0] + delimiter + "…" if len(parts) > 1 else "<string>"


def inspect_model(items, table, entity_attribute="entityType", delimiter="#"):
    pk = next(k["AttributeName"] for k in table["KeySchema"] if k["KeyType"] == "HASH")
    sk = next(
        (k["AttributeName"] for k in table["KeySchema"] if k["KeyType"] == "RANGE"),
        None,
    )
    entities, patterns, partitions = {}, {}, {}
    indexes = {
        index["IndexName"]: {
            "name": index["IndexName"],
            "included": 0,
            "excluded": 0,
            "invalid": 0,
            "missing": Counter(),
            "examples": [],
        }
        for index in table.get("GlobalSecondaryIndexes", [])
        + table.get("LocalSecondaryIndexes", [])
    }
    for item in items:
        size = item_metrics(item)["estimatedBytes"]
        entity = item.get(entity_attribute, {}).get("S") or key_pattern(
            item.get(sk) if sk else item.get(pk), delimiter
        )
        row = entities.setdefault(
            entity, {"name": entity, "count": 0, "bytes": 0, "attributes": {}}
        )
        row["count"] += 1
        row["bytes"] += size
        for name, attr in item.items():
            field = row["attributes"].setdefault(name, {"count": 0, "types": []})
            field["count"] += 1
            kind = next(iter(attr))
            if kind not in field["types"]:
                field["types"].append(kind)
        pattern = (
            key_pattern(item.get(pk), delimiter),
            key_pattern(item.get(sk), delimiter),
        )
        patterns[pattern] = patterns.get(pattern, 0) + 1
        signature = json.dumps(item[pk], sort_keys=True)
        partition = partitions.setdefault(
            signature, {"key": item[pk], "count": 0, "bytes": 0, "prefixes": []}
        )
        partition["count"] += 1
        partition["bytes"] += size
        value = item.get(sk, {}).get("S", "")
        if delimiter in value:
            prefix = value.split(delimiter)[0] + delimiter
            if prefix not in partition["prefixes"]:
                partition["prefixes"].append(prefix)
        for check in table_checks(item, table)["indexes"]:
            index = indexes[check["name"]]
            index[check["status"]] += 1
            index["missing"].update(check["missing"])
            if check["status"] == "included" and len(index["examples"]) < 5:
                definition = next(
                    i
                    for i in table.get("GlobalSecondaryIndexes", [])
                    + table.get("LocalSecondaryIndexes", [])
                    if i["IndexName"] == index["name"]
                )
                hash_name = next(
                    k["AttributeName"]
                    for k in definition["KeySchema"]
                    if k["KeyType"] == "HASH"
                )
                if item[hash_name] not in index["examples"]:
                    index["examples"].append(item[hash_name])
    return {
        "entities": sorted(
            entities.values(), key=lambda row: (-row["count"], row["name"])
        ),
        "patterns": [
            {"partition": p, "sort": s, "count": count}
            for (p, s), count in sorted(patterns.items())
        ],
        "partitions": sorted(partitions.values(), key=lambda row: -row["count"]),
        "indexes": list(indexes.values()),
        "count": len(items),
        "bytes": sum(row["bytes"] for row in entities.values()),
    }
