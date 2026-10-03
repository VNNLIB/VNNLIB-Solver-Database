#!/usr/bin/env python3
"""
app.py: read-only HTTP API over data/solvers.json.

Answers "given what I need, which solvers can do it". Nothing here writes; the
database is produced by scripts/build.py.

    pip install -r api/requirements.txt

    python3 api/app.py                  # the real database, data/solvers.json
    python3 api/app.py --dev            # tests/fixtures/solvers.demo.json
    python3 api/app.py --database PATH  # anything else

A WSGI host imports this module rather than running it, so there is no command
line there; SOLVERS_JSON does the same job.
"""

import argparse
import json
import os
import re
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

# Anchored to this file, not the working directory: a WSGI server imports the
# module from wherever it happens to be running.
REPO = Path(__file__).resolve().parent.parent

LIVE_DATABASE = REPO / "data" / "solvers.json"

# Fixture data: every status in one file, including failures the real database
# does not carry.
DEMO_DATABASE = REPO / "tests" / "fixtures" / "solvers.demo.json"

# Module level so a WSGI host, which never reaches __main__, can still point
# this somewhere else. The command line below overrides it.
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

# Asked for as "true" or "false". Section 5.4.3 of the standard calls these
# "other": neither a theory nor an ONNX fact. Both values are answerable.
BOOLEAN_FIELDS = ["serialise_assignments"]

FILTERS = THEORY_FIELDS + RANGE_FIELDS + BOOLEAN_FIELDS + ["operators", "element_types"]

# Presentation rather than selection. Kept apart from FILTERS so a typo in
# either is still rejected, and so /search can echo the filters back alone.
CONTROLS = ["name", "sort", "limit", "offset"]

_cache = {"mtime": None, "data": None}


EMPTY = {"schema_version": None, "generated_at": None, "solvers": []}


def database():
    """
    The database, re-read when the file changes on disk.

    Cached on mtime, so a new file is picked up without a restart. A missing or
    corrupt file yields the empty database and an "error" field rather than a
    500 on every endpoint.
    """
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
    matches every release that was measured. A release with no capabilities,
    meaning install_failed, never matches, not even an empty query: search answers
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

    for field in BOOLEAN_FIELDS:
        for wanted in query.get(field, []):
            # `is` rather than `==`, and an exact match on the boolean. A field
            # that is null, meaning the solver's answer was unusable, matches
            # neither true nor false: nothing was established about it, so it
            # cannot satisfy a question about it either way.
            if capabilities.get(field) is not (wanted == "true"):
                return False

    return True


def parse_query(args):
    """
    Query string to criteria. Repeats and commas both mean AND:
    ?arithmetic=POLY&operators=Conv,Relu wants all three.
    """
    query = {}
    # FILTERS, not a second hand-written list: the two drifting apart is how a
    # filter gets advertised by `/` and then silently ignored by `/search`.
    for field in FILTERS:
        values = []
        for raw in args.getlist(field):
            values += [v.strip() for v in raw.split(",") if v.strip()]
        if values:
            query[field] = values
    return query


def group_ranges(versions, matching_indices):
    """
    Matching releases as consecutive runs: [{"from": ..., "to": ..., "versions": [...]}].

    Two releases are consecutive when they are adjacent in `versions`, which
    SCHEMA.md makes a sorted array, so this never parses a version string: a
    second comparison rule here would eventually disagree with the build's.

    A run of one has `from` equal to `to`. Matching 1.0.0 and 2.0.0 but not the
    1.1.0 between them gives two runs, not one span.
    """
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
    """
    What a consumer needs to show one solver as a single row.

    `ranges` is the grouping above, `latest` is the newest matching release, and
    `matched` / `total` are counts.
    """
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
    """
    Solvers with at least one release matching, carrying only those releases.

    Each result also carries `matches`, which groups those releases into
    consecutive ranges. That grouping needs each release's position in the
    solver's full version list, which only this side has.
    """
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
    """
    Ordering for a version string: digit runs compare as numbers, so 1.10.0
    sorts after 1.9.0 rather than before it.

    The same rule as `version_sort_key` in scripts/build.py, duplicated rather
    than imported so deploying the API does not pull in the collection pipeline.
    Change one and change the other.
    """
    parts = []
    for chunk in re.split(r"(\d+)", str(version)):
        if chunk.isdigit():
            parts.append((1, int(chunk), ""))
        elif chunk:
            parts.append((0, 0, chunk))
    return parts


# Sort key to what it orders on. `latest` is the newest matching release, which
# is what a result is dated and versioned by: a solver is as current as its
# newest usable release.
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

# A ceiling, so one request cannot ask for the whole database by accident.
MAX_LIMIT = 200


def matches_name(solver, needle):
    """
    Whether a solver's display name or its id contains `needle`, case-insensitively.

    The id is matched as well as the name because the id is what appears in URLs.
    """
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
    """
    Let a caller on another origin read this.

    Safe to open to everyone: the data is public and read-only, and there is no
    session or credential to steal.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/")
def index():
    data = database()
    return jsonify(
        {
            "schema_version": data["schema_version"],
            "generated_at": data["generated_at"],
            # Collected data or the fixture, so nobody builds against demo
            # numbers thinking they are real.
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
    data = database()
    return jsonify(
        {
            # False when the file is there but unreadable: the process is
            # alive, the data is not, and a monitor should tell them apart.
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
    data = database()
    return jsonify({"generated_at": data["generated_at"], "solvers": data["solvers"]})


@app.get("/solvers/<solver_id>")
def solver(solver_id):
    for entry in database()["solvers"]:
        if isinstance(entry, dict) and entry.get("id") == solver_id:
            return jsonify(entry)
    return jsonify({"error": f"no solver with id {solver_id!r}"}), 404


@app.get("/vocabulary")
def vocabulary():
    """
    Every operator name and element type any solver reports, read from the whole
    database rather than from one page of results.

    `operators` maps each name to the types it can usefully be asked for, which
    is not simply the types printed beside it. Section 5.4.1 says an operator
    listed with no types supports *every* type that solver reports, so the union
    is the explicit lists plus, for any solver that listed the operator bare,
    that solver's whole `element_types`.
    """
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
    query = parse_query(request.args)
    unknown = set(request.args) - set(FILTERS) - set(CONTROLS)
    if unknown:
        # Silently ignoring a typo would return everything and look like a
        # successful search, which is the worst possible answer.
        return jsonify({"error": f"unknown filter(s): {sorted(unknown)}"}), 400

    sort = request.args.get("sort", DEFAULT_SORT)
    if sort not in SORTS:
        # Falling back to the default would answer a different question than the
        # one asked and look like it had worked.
        return jsonify(
            {"error": f"unknown sort {sort!r}, expected one of {sorted(SORTS)}"}
        ), 400

    for field in BOOLEAN_FIELDS:
        bad = [v for v in query.get(field, []) if v not in ("true", "false")]
        if bad:
            # Rejected rather than coerced: anything truthy-looking would answer
            # a different question than the one asked and look like it worked.
            return jsonify(
                {"error": f"{field} must be 'true' or 'false', got {sorted(bad)}"}
            ), 400

    name = (request.args.get("name") or "").strip()
    limit = positive_int(request.args.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    offset = positive_int(request.args.get("offset"), 0)

    results = search(query, name)

    key, reverse = SORTS[sort]
    results.sort(key=key, reverse=reverse)

    # `total` is the whole result set, `solvers` is one page of it.
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
            # Kept for callers written against the older response, where count
            # was the number of solvers returned and there was only ever one
            # page of them.
            "count": len(page),
            "solvers": page,
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
