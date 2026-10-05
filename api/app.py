#!/usr/bin/env python3
"""app.py: read-only HTTP API over data/solvers.json."""

import argparse
import json
import os
import re
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

REPO = Path(__file__).resolve().parent.parent

LIVE_DATABASE = REPO / "data" / "solvers.json"

DEMO_DATABASE = REPO / "tests" / "fixtures" / "solvers.demo.json"

DATABASE = Path(os.environ.get("SOLVERS_JSON", LIVE_DATABASE))

THEORY_FIELDS = [
    "hidden_nodes",
    "multiple_io",
    "multiple_networks",
    "node_comparisons",
    "arithmetic",
]

RANGE_FIELDS = ["onnx_opset", "vnnlib_versions"]

BOOLEAN_FIELDS = ["serialise_assignments"]

FILTERS = THEORY_FIELDS + RANGE_FIELDS + BOOLEAN_FIELDS + ["operators", "element_types"]

CONTROLS = ["name", "sort", "limit", "offset"]

_cache = {"mtime": None, "data": None}


EMPTY = {"schema_version": None, "generated_at": None, "solvers": []}


def database():
    """The database, re-read when the file changes on disk."""
    if not DATABASE.exists():
        return dict(EMPTY)

    mtime = DATABASE.stat().st_mtime
    if _cache["mtime"] != mtime:
        try:
            data = json.loads(DATABASE.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("solvers"), list):
                raise ValueError("no 'solvers' list")
            data = {**EMPTY, **data}
        except (ValueError, OSError) as exc:
            data = {**EMPTY, "error": f"{DATABASE.name} could not be read: {exc}"}
        _cache["data"] = data
        _cache["mtime"] = mtime
    return _cache["data"]


def solver_versions(solver):
    """A solver's releases, tolerating an entry that has none."""
    versions = solver.get("versions")
    return versions if isinstance(versions, list) else []


def operator_types(capabilities):
    """{operator name: [types it is restricted to]} for one version."""
    operators = capabilities.get("operators") or []
    if isinstance(operators, dict):
        return {name: list(types or []) for name, types in operators.items()}
    parsed = {}
    for line in operators:
        name, *types = str(line).split()
        parsed[name] = types
    return parsed


def operator_matches(capabilities, wanted):
    """Whether a version supports "Conv", or "Conv:float64" at one element type."""
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
    try:
        return float(low) <= float(wanted) <= float(high)
    except (TypeError, ValueError):
        return str(low) <= str(wanted) <= str(high)


def version_matches(record, query):
    """Whether one release satisfies every criterion given."""
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

    for field in BOOLEAN_FIELDS:
        for wanted in query.get(field, []):
            if capabilities.get(field) is not (wanted == "true"):
                return False

    return True


def parse_query(args):
    """Query string to criteria."""
    query = {}
    for field in FILTERS:
        values = []
        for raw in args.getlist(field):
            values += [v.strip() for v in raw.split(",") if v.strip()]
        if values:
            query[field] = values
    return query


def group_ranges(versions, matching_indices):
    """Matching releases as consecutive runs: [{"from": ..., "to": ..., "versions": [...]}]."""
    runs = []
    for index in matching_indices:
        version = versions[index]["version"]
        if runs and index == runs[-1]["_last_index"] + 1:
            runs[-1]["to"] = version
            runs[-1]["versions"].append(version)
            runs[-1]["_last_index"] = index
        else:
            runs.append(
                {
                    "from": version,
                    "to": version,
                    "versions": [version],
                    "_last_index": index,
                }
            )
    for run in runs:
        del run["_last_index"]
    return runs


def match_summary(solver, matching_indices):
    """What a consumer needs to show one solver as a single row."""
    versions = solver_versions(solver)
    latest = versions[matching_indices[-1]]
    return {
        "ranges": group_ranges(versions, matching_indices),
        "latest": {
            "version": latest["version"],
            "collected_at": latest.get("collected_at"),
        },
        "matched": len(matching_indices),
        "total": len(versions),
    }


def search(query, name=""):
    """Solvers with at least one release matching, carrying only those releases."""
    results = []
    for solver in database()["solvers"]:
        if not isinstance(solver, dict):
            continue
        if not matches_name(solver, name):
            continue
        versions = solver_versions(solver)
        indices = [i for i, v in enumerate(versions) if version_matches(v, query)]
        if indices:
            results.append(
                {
                    **solver,
                    "versions": [versions[i] for i in indices],
                    "matches": match_summary(solver, indices),
                }
            )
    return results


def natural_key(version):
    """Ordering for a version string, with digit runs compared as numbers."""
    parts = []
    for chunk in re.split(r"(\d+)", str(version)):
        if chunk.isdigit():
            parts.append((1, int(chunk), ""))
        elif chunk:
            parts.append((0, 0, chunk))
    return parts


SORTS = {
    "name-asc": (lambda r: (r["name"].lower(), natural_key(r["matches"]["latest"]["version"])), False),
    "name-desc": (lambda r: (r["name"].lower(), natural_key(r["matches"]["latest"]["version"])), True),
    "version-asc": (lambda r: (natural_key(r["matches"]["latest"]["version"]), r["name"].lower()), False),
    "version-desc": (lambda r: (natural_key(r["matches"]["latest"]["version"]), r["name"].lower()), True),
    "date-asc": (lambda r: (r["matches"]["latest"].get("collected_at") or "", r["name"].lower()), False),
    "date-desc": (lambda r: (r["matches"]["latest"].get("collected_at") or "", r["name"].lower()), True),
}

DEFAULT_SORT = "date-desc"

DEFAULT_LIMIT = 10

MAX_LIMIT = 200


def matches_name(solver, needle):
    """Whether a solver's display name or its id contains `needle`, case-insensitively."""
    if not needle:
        return True
    needle = needle.lower()
    return needle in str(solver.get("name") or "").lower() or needle in str(
        solver.get("id") or ""
    ).lower()


def positive_int(raw, default, maximum=None):
    """A query-string integer, or the default if it is missing or nonsense."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    if value < 0:
        return default
    if maximum is not None:
        value = min(value, maximum)
    return value


@app.after_request
def allow_cross_origin(response):
    """Let a caller on another origin read this."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/")
def index():
    """The database's version, when it was generated, and what can be filtered on."""
    data = database()
    return jsonify(
        {
            "schema_version": data["schema_version"],
            "generated_at": data["generated_at"],
            "source": "demo" if DATABASE == DEMO_DATABASE else "collected",
            "solvers": len(data["solvers"]),
            "endpoints": {
                "/solvers": "every solver",
                "/solvers/<id>": "one solver",
                "/search": "filter, sort and page, e.g. "
                "/search?arithmetic=POLY&operators=Conv&sort=name-asc&limit=10",
                "/vocabulary": "every operator name and element type in the database",
                "/health": "liveness",
            },
            "filters": FILTERS,
            "controls": {
                "name": "substring of the display name or the id",
                "sort": sorted(SORTS),
                "limit": f"page size, default {DEFAULT_LIMIT}, maximum {MAX_LIMIT}",
                "offset": "how many results to skip",
            },
            **({"error": data["error"]} if "error" in data else {}),
        }
    )


@app.get("/health")
def health():
    """Whether the service is up and the database file readable."""
    data = database()
    return jsonify(
        {
            "ok": "error" not in data,
            "database": str(DATABASE),
            "exists": DATABASE.exists(),
            "source": "demo" if DATABASE == DEMO_DATABASE else "collected",
            "generated_at": data["generated_at"],
            "solvers": len(data["solvers"]),
            **({"error": data["error"]} if "error" in data else {}),
        }
    )


@app.get("/solvers")
def solvers():
    """Every solver, with every release, unfiltered."""
    data = database()
    return jsonify({"generated_at": data["generated_at"], "solvers": data["solvers"]})


@app.get("/solvers/<solver_id>")
def solver(solver_id):
    """One solver by id, or 404."""
    for entry in database()["solvers"]:
        if isinstance(entry, dict) and entry.get("id") == solver_id:
            return jsonify(entry)
    return jsonify({"error": f"no solver with id {solver_id!r}"}), 404


@app.get("/vocabulary")
def vocabulary():
    """Every operator name and element type any solver reports."""
    operators = {}
    element_types = set()
    for solver in database()["solvers"]:
        if not isinstance(solver, dict):
            continue
        for record in solver_versions(solver):
            capabilities = record.get("capabilities") or {}
            reported = capabilities.get("element_types") or []
            element_types.update(reported)
            for name, restricted_to in operator_types(capabilities).items():
                known = operators.setdefault(name, set())
                known.update(restricted_to if restricted_to else reported)
    return jsonify(
        {
            "generated_at": database()["generated_at"],
            "operators": {name: sorted(types) for name, types in sorted(operators.items())},
            "element_types": sorted(element_types),
        }
    )


@app.get("/search")
def search_endpoint():
    """Solvers matching the query, each carrying only its matching releases."""
    query = parse_query(request.args)
    unknown = set(request.args) - set(FILTERS) - set(CONTROLS)
    if unknown:
        return jsonify({"error": f"unknown filter(s): {sorted(unknown)}"}), 400

    sort = request.args.get("sort", DEFAULT_SORT)
    if sort not in SORTS:
        return jsonify(
            {"error": f"unknown sort {sort!r}, expected one of {sorted(SORTS)}"}
        ), 400

    for field in BOOLEAN_FIELDS:
        bad = [v for v in query.get(field, []) if v not in ("true", "false")]
        if bad:
            return jsonify(
                {"error": f"{field} must be 'true' or 'false', got {sorted(bad)}"}
            ), 400

    name = (request.args.get("name") or "").strip()
    limit = positive_int(request.args.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    offset = positive_int(request.args.get("offset"), 0)

    results = search(query, name)

    key, reverse = SORTS[sort]
    results.sort(key=key, reverse=reverse)

    page = results[offset : offset + limit] if limit else results

    return jsonify(
        {
            "generated_at": database()["generated_at"],
            "query": query,
            "name": name,
            "sort": sort,
            "limit": limit,
            "offset": offset,
            "total": len(results),
            "count": len(page),
            "solvers": page,
        }
    )


def parse_args():
    """The command-line options for running the API directly."""
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

    print(f"serving {DATABASE.resolve()}" + ("" if DATABASE.exists() else "  (MISSING)"))
    app.run(host=args.host, port=args.port)
