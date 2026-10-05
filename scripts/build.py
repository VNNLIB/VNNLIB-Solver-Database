#!/usr/bin/env python3
"""build.py: fold the records register.py produced into data/solvers.json."""

import argparse
import copy
import json
import re
import sys
from pathlib import Path

import schema
import validate


def empty_database():
    """The shape of a database with nothing in it yet."""
    return {
        "schema_version": schema.SCHEMA_VERSION,
        "generated_at": schema.now_iso(),
        "solvers": [],
    }


def load_database(path):
    """The database on disk, or an empty one."""
    path = Path(path)
    if not path.exists() or path.stat().st_size == 0:
        return empty_database()

    try:
        with path.open(encoding="utf-8") as handle:
            database = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: not valid JSON ({exc}). Refusing to overwrite it.")

    found = database.get("schema_version", "")
    if schema.major(found) != schema.major(schema.SCHEMA_VERSION):
        raise SystemExit(
            f"{path}: schema_version {found!r} is not readable by this build "
            f"(expected major {schema.major(schema.SCHEMA_VERSION)}). Refusing "
            f"to overwrite a file this script does not understand."
        )
    database.setdefault("solvers", [])
    return database


def load_results(path):
    """register.py's JSON Lines as a list of Solver entries."""
    solvers = []
    with Path(path).open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{number}: not valid JSON ({exc})")
            if not isinstance(entry, dict):
                raise SystemExit(f"{path}:{number}: expected an object, got {type(entry).__name__}")
            if not entry.get("id") or not isinstance(entry.get("versions"), list):
                raise SystemExit(f"{path}:{number}: missing 'id', or 'versions' is not a list")
            for record in entry["versions"]:
                if not isinstance(record, dict) or not record.get("version"):
                    raise SystemExit(f"{path}:{number}: a version record has no 'version'")
            solvers.append(entry)
    return solvers


def version_sort_key(version):
    """Natural ordering, so 1.10.0 sorts after 1.9.0."""
    key = []
    for chunk in re.split(r"(\d+)", str(version)):
        if chunk.isdigit():
            key.append((0, int(chunk), ""))
        elif chunk:
            key.append((1, 0, chunk))
    return key


def merge_solver(existing, incoming):
    """Fold a collected entry into the one on file: same version replaced, new version added."""
    by_version = {v["version"]: v for v in existing.get("versions", [])}
    for version_record in incoming.get("versions", []):
        by_version[version_record["version"]] = version_record

    merged = dict(existing)
    for field in ("name", "url"):
        if incoming.get(field):
            merged[field] = incoming[field]
        else:
            merged.setdefault(field, existing.get(field, ""))
    merged["id"] = existing.get("id") or incoming["id"]
    merged["versions"] = sorted(by_version.values(), key=lambda v: version_sort_key(v["version"]))
    return merged


def offered_versions(solvers_dir):
    """{(id, version)} for every release still on offer, or None if solvers/ is not there at all."""
    solvers_dir = Path(solvers_dir)
    if not solvers_dir.is_dir():
        return None

    offered = set()
    for solver in sorted(solvers_dir.iterdir()):
        if not solver.is_dir():
            continue
        if validate.is_withdrawn(solver):
            continue
        for version in sorted(solver.iterdir()):
            if version.is_dir() and not validate.is_withdrawn(version):
                offered.add((solver.name, version.name))
    return offered


def retire_failures(results, solvers_dir):
    """Write `withdrawn = true` into the solver.toml of every release that failed."""
    retired = []
    for entry in results:
        for record in entry.get("versions", []):
            if record.get("status") == "ok":
                continue
            directory = Path(solvers_dir) / entry["id"] / record["version"]
            if validate.retire(directory):
                retired.append(directory)
    return retired


def drop_incomplete(by_id):
    """Remove every release that did not collect cleanly, and any solver left with none."""
    kept = {}
    for solver_id, solver in by_id.items():
        versions = [
            record for record in solver.get("versions", [])
            if record.get("status") == "ok"
        ]
        if versions:
            kept[solver_id] = {**solver, "versions": versions}
    return kept


def drop_withdrawn(by_id, offered):
    """Remove every release that is no longer on offer, and any solver left with no releases at all."""
    if offered is None:
        return by_id

    kept = {}
    for solver_id, solver in by_id.items():
        versions = [
            record
            for record in solver.get("versions", [])
            if (solver_id, record.get("version")) in offered
        ]
        if versions:
            kept[solver_id] = {**solver, "versions": versions}
    return kept


def build(database, results, offered=None):
    """A new database with every entry in results merged in, keyed by id."""
    by_id = {
        solver["id"]: copy.deepcopy(solver) for solver in database.get("solvers", [])
    }

    for incoming in results:
        solver_id = incoming["id"]
        if solver_id in by_id:
            by_id[solver_id] = merge_solver(by_id[solver_id], incoming)
        else:
            incoming = dict(incoming)
            incoming["versions"] = sorted(
                incoming.get("versions", []),
                key=lambda v: version_sort_key(v["version"]),
            )
            by_id[solver_id] = incoming

    by_id = drop_withdrawn(by_id, offered)
    by_id = drop_incomplete(by_id)

    duplicates = _duplicate_urls(by_id.values())
    for url, ids in duplicates.items():
        print(f"warning: {url} is registered under {len(ids)} ids: "
              f"{', '.join(ids)}", file=sys.stderr)

    merged = dict(database)
    merged["schema_version"] = schema.SCHEMA_VERSION
    merged["generated_at"] = schema.now_iso()
    merged["solvers"] = sorted(by_id.values(), key=lambda s: s["id"])
    return merged


def _version_map(database):
    """{(solver id, version): record} for every version in the database."""
    return {
        (solver["id"], version["version"]): version
        for solver in database.get("solvers", [])
        for version in solver.get("versions", [])
    }


def describe_changes(before, after):
    """(added, updated, removed) lists of (id, version)."""
    old, new = _version_map(before), _version_map(after)
    added = sorted(key for key in new if key not in old)
    updated = sorted(key for key in new if key in old and new[key] != old[key])
    removed = sorted(key for key in old if key not in new)
    return added, updated, removed


def is_unchanged(before, after):
    """True when the merge produced nothing new."""
    strip = lambda db: {k: v for k, v in db.items() if k != "generated_at"}
    return strip(before) == strip(after)


def _duplicate_urls(solvers):
    """{url: [id, ...]} for every non-empty url claimed by more than one id."""
    seen = {}
    for solver in solvers:
        url = solver.get("url") or ""
        if url:
            seen.setdefault(url, []).append(solver["id"])
    return {url: ids for url, ids in seen.items() if len(ids) > 1}


def write_database(database, path):
    """Write the database, formatted for review in a pull request diff."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(database, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def summarise(database):
    """One line per solver for the Actions log."""
    for solver in database["solvers"]:
        versions = ", ".join(v["version"] for v in solver["versions"])
        statuses = {v["status"] for v in solver["versions"]}
        yield f"{solver['id']}: {len(solver['versions'])} version(s) [{versions}] {sorted(statuses)}"


def main():
    """Merge a results file into the database and report what changed."""
    parser = argparse.ArgumentParser(
        description="Merge register.py's results.jsonl into data/solvers.json."
    )
    
    parser.add_argument("results", help="JSON Lines file written by register.py")
    parser.add_argument(
        "--database",
        default="data/solvers.json",
        help="existing database to merge into (default: data/solvers.json)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="where to write (default: same as --database, i.e. in place)",
    )
    parser.add_argument(
        "--solvers-dir",
        default=None,
        help="submissions directory. Given, a release is dropped from the "
        "database when its solver.toml retires it or its directory is gone. "
        "Omitted, nothing is ever dropped: removing records is destructive, so "
        "it has to be asked for rather than happen because of where you "
        "were standing",
    )
    parser.add_argument(
        "--retire-failed",
        action="store_true",
        help="write `withdrawn = true` into the solver.toml of any release in "
        "this run that did not collect cleanly, so it is not reinstalled on "
        "every later push. Requires --solvers-dir",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args()

    offered = None
    if args.solvers_dir:
        offered = offered_versions(args.solvers_dir)
        if offered is None:
            print(f"note: {args.solvers_dir} not found, dropping nothing", file=sys.stderr)

    results = load_results(args.results)

    if args.retire_failed:
        if not args.solvers_dir:
            raise SystemExit("--retire-failed needs --solvers-dir to know what to write to")
        for directory in retire_failures(results, args.solvers_dir):
            print(f"retired {directory}: it did not collect cleanly", file=sys.stderr)

    before = load_database(args.database)
    after = build(before, results, offered)
    output = args.output or args.database

    added, updated, removed = describe_changes(before, after)
    for solver_id, version in added:
        print(f"+ {solver_id} {version}", file=sys.stderr)
    for solver_id, version in updated:
        print(f"~ {solver_id} {version} (re-collected)", file=sys.stderr)
    for solver_id, version in removed:
        gone = args.solvers_dir and not (Path(args.solvers_dir) / solver_id / version).is_dir()
        why = "submission deleted" if gone else "retired"
        print(f"- {solver_id} {version} ({why})", file=sys.stderr)

    if is_unchanged(before, after) and Path(output) == Path(args.database):
        print(f"no changes; {output} left untouched", file=sys.stderr)
        return 0

    if args.dry_run:
        print(f"dry run; {output} not written", file=sys.stderr)
        return 0

    write_database(after, output)
    for line in summarise(after):
        print(line, file=sys.stderr)
    print(f"wrote {output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
