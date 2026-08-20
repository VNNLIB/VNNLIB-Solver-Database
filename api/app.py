#!/usr/bin/env python3
"""
app.py — read-only HTTP API over data/solvers.json.

Where a solver's `supports` command reports what it can do, this answers the
opposite question: given what you need, which solvers can do it. Same idea as
the vnnfilter package, over HTTP.

Nothing here writes. The database is produced by scripts/build.py and updated
by a workflow; this process only reads the file back.

    pip install -r api/requirements.txt

    python3 api/app.py                  # the real database, data/solvers.json
    python3 api/app.py --dev            # tests/fixtures/solvers.demo.json
    python3 api/app.py --database PATH  # anything else

Under gunicorn there is no command line, so SOLVERS_JSON does the same job.
"""

import argparse
import json
import os
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

# What the collection pipeline writes, and what a deployment serves.
LIVE_DATABASE = Path("data/solvers.json")

# Fixture data: every status in one file, including releases that failed to
# install. Useful precisely because the real database may hold only successes.
DEMO_DATABASE = Path("tests/fixtures/solvers.demo.json")

# Module level so gunicorn, which never runs __main__, can still be pointed
# somewhere else. The command line below overrides it.
DATABASE = Path(os.environ.get("SOLVERS_JSON", LIVE_DATABASE))

# Theory fields are matched against `satisfies`, not `capabilities`: the
# downward closure is already computed there, so "give me OUTC" correctly
# matches a solver that reported only POLY.
THEORY_FIELDS = [
    "hidden_nodes",
    "multiple_io",
    "multiple_networks",
    "node_comparisons",
    "arithmetic",
]

# Asked for as a single value, checked against an inclusive [min, max] pair.
RANGE_FIELDS = ["onnx_opset", "vnnlib_versions"]

_cache = {"mtime": None, "data": None}


def database():
    """
    The database, re-read when the file changes on disk.

    Cached on mtime so a workflow committing a new file is picked up without
    a restart, but a busy endpoint does not re-parse JSON on every request.
    """
    if not DATABASE.exists():
        return {"schema_version": None, "generated_at": None, "solvers": []}
    mtime = DATABASE.stat().st_mtime
    if _cache["mtime"] != mtime:
        _cache["data"] = json.loads(DATABASE.read_text(encoding="utf-8"))
        _cache["mtime"] = mtime
    return _cache["data"]


def operator_types(capabilities):
    """
    {operator name: [types it is restricted to]} for one version.

    Handles both shapes collect.py might hand over: the raw lines it stores
    today ("Conv float64 float32", "Relu"), and the object SCHEMA.md
    describes ({"Conv": ["float64"], "Relu": []}).
    """
    operators = capabilities.get("operators") or []
    if isinstance(operators, dict):
        return {name: list(types or []) for name, types in operators.items()}
    parsed = {}
    for line in operators:
        name, *types = str(line).split()
        parsed[name] = types
    return parsed


def operator_matches(capabilities, wanted):
    """
    Whether a version supports one operator, optionally at one element type:
    "Conv" or "Conv:float64".

    The trap, straight from Section 5.4.1: an operator listed with NO types
    supports *every* type in element_types, not none. Reading an empty list
    as "supports nothing" is the single easiest mistake to make here, and it
    would silently exclude the solvers that support the most.
    """
    name, _, wanted_type = wanted.partition(":")
    supported = operator_types(capabilities)
    if name not in supported:
        return False
    if not wanted_type:
        return True

    restricted_to = supported[name]
    if restricted_to:
        return wanted_type in restricted_to
    return wanted_type in (capabilities.get("element_types") or [])


def in_range(pair, wanted):
    """True if wanted falls inside an inclusive [min, max] pair."""
    if not pair or len(pair) != 2:
        return False
    low, high = pair
    try:  # opset versions are ints, vnnlib versions are strings like "2.0"
        return float(low) <= float(wanted) <= float(high)
    except (TypeError, ValueError):
        return str(low) <= str(wanted) <= str(high)


def version_matches(record, query):
    """
    Whether one release satisfies every criterion given.

    A criterion left out is ignored rather than assumed, so an empty query
    matches every release that was measured. A release with no capabilities —
    install_failed — never matches, not even an empty query: search answers
    "what can do this", and nothing is known about what it can do. Use
    /solvers to see those.
    """
    capabilities = record.get("capabilities")
    if not capabilities:
        return False

    satisfies = record.get("satisfies") or {}

    for field in THEORY_FIELDS:
        for wanted in query.get(field, []):
            if wanted not in (satisfies.get(field) or []):
                return False

    for field in RANGE_FIELDS:
        for wanted in query.get(field, []):
            if not in_range(capabilities.get(field), wanted):
                return False

    for wanted in query.get("operators", []):
        if not operator_matches(capabilities, wanted):
            return False

    for wanted in query.get("element_types", []):
        if wanted not in (capabilities.get("element_types") or []):
            return False

    return True


def parse_query(args):
    """
    Query string to criteria. Repeats and commas both mean AND:
    ?arithmetic=POLY&operators=Conv,Relu wants all three.
    """
    query = {}
    fields = THEORY_FIELDS + RANGE_FIELDS + ["operators", "element_types"]
    for field in fields:
        values = []
        for raw in args.getlist(field):
            values += [v.strip() for v in raw.split(",") if v.strip()]
        if values:
            query[field] = values
    return query


def search(query):
    """Solvers with at least one release matching, carrying only those releases."""
    results = []
    for solver in database()["solvers"]:
        matching = [v for v in solver["versions"] if version_matches(v, query)]
        if matching:
            results.append({**solver, "versions": matching})
    return results


@app.get("/")
def index():
    data = database()
    return jsonify(
        {
            "schema_version": data["schema_version"],
            "generated_at": data["generated_at"],
            "solvers": len(data["solvers"]),
            "endpoints": {
                "/solvers": "every solver",
                "/solvers/<id>": "one solver",
                "/search": "filter, e.g. /search?arithmetic=POLY&operators=Conv",
                "/health": "liveness",
            },
            "filters": THEORY_FIELDS + RANGE_FIELDS + ["operators", "element_types"],
        }
    )


@app.get("/health")
def health():
    return jsonify({"ok": True, "database": str(DATABASE), "exists": DATABASE.exists()})


@app.get("/solvers")
def solvers():
    data = database()
    return jsonify({"generated_at": data["generated_at"], "solvers": data["solvers"]})


@app.get("/solvers/<solver_id>")
def solver(solver_id):
    for entry in database()["solvers"]:
        if entry["id"] == solver_id:
            return jsonify(entry)
    return jsonify({"error": f"no solver with id {solver_id!r}"}), 404


@app.get("/search")
def search_endpoint():
    query = parse_query(request.args)
    unknown = set(request.args) - set(
        THEORY_FIELDS + RANGE_FIELDS + ["operators", "element_types"]
    )
    if unknown:
        # Silently ignoring a typo would return everything and look like a
        # successful search, which is the worst possible answer.
        return jsonify({"error": f"unknown filter(s): {sorted(unknown)}"}), 400

    results = search(query)
    return jsonify(
        {
            "generated_at": database()["generated_at"],
            "query": query,
            "count": len(results),
            "solvers": results,
        }
    )


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--dev",
        action="store_true",
        help=f"serve the demo fixture ({DEMO_DATABASE}) instead of the real database",
    )
    source.add_argument("--database", help="serve a specific file")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)))
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.dev:
        DATABASE = DEMO_DATABASE
    elif args.database:
        DATABASE = Path(args.database)

    # Said out loud at startup: serving the demo fixture while believing it is
    # the real database is the one mistake this flag makes easy.
    print(f"serving {DATABASE.resolve()}" + ("" if DATABASE.exists() else "  (MISSING)"))
    app.run(host=args.host, port=args.port)
