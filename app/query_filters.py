"""Build safe DynamoDB filter expressions with aliased attribute names."""
from .data_codec import attribute_from_wire


def apply_read_options(arguments, request, table):
    names = arguments.setdefault("ExpressionAttributeNames", {})
    values = arguments.setdefault("ExpressionAttributeValues", {})
    if request.consistent:
        if any(
            i["IndexName"] == request.index
            for i in table.get("GlobalSecondaryIndexes", [])
        ):
            raise ValueError(
                "Global secondary indexes only support eventually consistent reads"
            )
        arguments["ConsistentRead"] = True
    if request.filters and request.filterExpression:
        raise ValueError("Use either the filter builder or an expression, not both")
    expressions = []
    for i, rule in enumerate(request.filters):
        alias, token = f"#filter{i}", f":filter{i}"
        names[alias] = rule.attribute
        op = rule.operator
        if op in {"exists", "not_exists"}:
            expressions.append(f"attribute_{op}({alias})")
            continue
        if rule.value is None:
            raise ValueError(f"Filter {i + 1} needs a value")
        values[token] = attribute_from_wire(rule.value)
        if op in {"contains", "begins_with", "attribute_type"}:
            expressions.append(f"{op}({alias}, {token})")
        elif op == "between":
            if rule.end is None:
                raise ValueError(f"Filter {i + 1} needs a range end")
            values[token + "end"] = attribute_from_wire(rule.end)
            expressions.append(f"{alias} BETWEEN {token} AND {token}end")
        else:
            expressions.append(f"{alias} {op} {token}")
    if expressions:
        arguments["FilterExpression"] = (f" {request.filterJoin} ").join(
            f"({e})" for e in expressions
        )
    if request.filterExpression:
        if (
            set(names) & request.expressionNames.keys()
            or set(values) & request.expressionValues.keys()
        ):
            raise ValueError(
                "Expression aliases conflict with query keys; use different aliases"
            )
        arguments["FilterExpression"] = request.filterExpression
        names.update(request.expressionNames)
        values.update(
            {
                key: attribute_from_wire(value)
                for key, value in request.expressionValues.items()
            }
        )
    if request.projection:
        # Always include the base table keys so projected results remain editable.
        attributes = list(
            dict.fromkeys(
                request.projection + [k["AttributeName"] for k in table["KeySchema"]]
            )
        )
        aliases = []
        for i, attribute in enumerate(attributes):
            alias = f"#project{i}"
            if alias in names:
                raise ValueError(
                    "Aliases beginning #project are reserved for returned attributes"
                )
            names[alias] = attribute
            aliases.append(alias)
        arguments["ProjectionExpression"] = ", ".join(aliases)
    for key in ["ExpressionAttributeNames", "ExpressionAttributeValues"]:
        if not arguments[key]:
            arguments.pop(key)
