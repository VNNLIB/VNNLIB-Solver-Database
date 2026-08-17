#!/usr/bin/env python3
"""
build.py — fold the records register.py produced into data/solvers.json.

register.py writes one Solver entry per line to results.jsonl; this merges
those into the database on disk. It never installs or queries anything.

A merge, never a regeneration. The database on disk is the starting point and
a run only adds to it or replaces the exact versions it collected, per
SUBMITTING.md's "Updating":

  - re-collecting a version OVERWRITES it, it does not duplicate
  - versions are never removed
  - a solver absent from results.jsonl is left exactly as it was
  - unrecognised top-level fields are carried through
  - if nothing changed, the file is not rewritten, so a no-op leaves no diff

Testing: see tests/README.md.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import schema


def empty_database():
    """The shape of a database with nothing in it yet."""
    return {
        "schema_version": schema.SCHEMA_VERSION,
        "generated_at": schema.now_iso(),
        "solvers": [],
    }


def load_database(path):
    """
    The database on disk, or an empty one. Refuses a file whose MAJOR schema
    version differs: carrying the version exists so a reader can decline
    rather than half-understand a file.
    """
    path = Path(path)
    # Zero bytes counts as absent: that is what a truncated or touch-created
    # file looks like, and there is nothing in it to preserve.
    if not path.exists() or path.stat().st_size == 0:
        return empty_database()

    try:
        with path.open(encoding="utf-8") as handle:
            database = json.load(handle)
    except json.JSONDecodeError as exc:
        # Named, not a traceback: the fix is to restore or delete the file,
        # and overwriting it silently would destroy whatever is left.
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
    """
    register.py's JSON Lines as a list of Solver entries. A malformed line is
    fatal and names its number: silently dropping a solver is how a database
    quietly stops matching reality.
    """
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
            if not entry.get("id") or "versions" not in entry:
                raise SystemExit(f"{path}:{number}: missing 'id' or 'versions'")
            solvers.append(entry)
    return solvers


def version_sort_key(version):
    """
    Natural ordering, so 1.10.0 sorts after 1.9.0. Digit runs compare as
    numbers, text after numbers so 'unknown' lands last.

    Deliberately NOT semver: nothing says these strings are semver, and
    guessing wrong would silently misorder a release. So 1.0.0-rc1 sorts
    after 1.0.0, not before.
    """
    key = []
    for chunk in re.split(r"(\d+)", str(version)):
        if chunk.isdigit():
            key.append((0, int(chunk), ""))
        elif chunk:
            key.append((1, 0, chunk))
    return key


def merge_solver(existing, incoming):
    """
    Fold a collected entry into the one on file: same version replaced, new
    version added. Sorted ascending, which SCHEMA.md makes part of the
    contract — consumers compute ranges from the ordering alone.
    """
    by_version = {v["version"]: v for v in existing.get("versions", [])}
    for version_record in incoming.get("versions", []):
        by_version[version_record["version"]] = version_record

    merged = dict(existing)
    # Incoming wins on display fields, but only when it actually has a value:
    # repo is still empty out of register.py (known gap), and an empty string
    # must not wipe a repo someone filled in by hand.
    for field in ("name", "repo"):
        if incoming.get(field):
            merged[field] = incoming[field]
        else:
            merged.setdefault(field, existing.get(field, ""))
    merged["id"] = existing.get("id") or incoming["id"]
    merged["versions"] = sorted(by_version.values(), key=lambda v: version_sort_key(v["version"]))
    return merged


def build(database, results):
    """
    A new database with every entry in results merged in, keyed by id (the
    directory name, which never changes). repo is SCHEMA.md's key for
    detecting the same solver submitted twice, which is warned about below.
    """
    by_id = {solver["id"]: solver for solver in database.get("solvers", [])}

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

    # Two ids sharing one repo is the duplicate-submission case SCHEMA.md
    # wants caught. A warning, not a failure: it needs a human to decide which
    # id is the real one, and dropping either silently would be worse.
    duplicates = _duplicate_repos(by_id.values())
    for repo, ids in duplicates.items():
        print(f"warning: {repo} is registered under {len(ids)} ids: {', '.join(ids)}",
              file=sys.stderr)

    # Starts from the existing file, so any top-level field this script does
    # not know about survives instead of being dropped on the next run.
    merged = dict(database)
    merged["schema_version"] = schema.SCHEMA_VERSION
    merged["generated_at"] = schema.now_iso()
    # SCHEMA.md guarantees no order, but sorting by id keeps the committed
    # file's diff limited to what actually changed.
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
    """
    (added, updated, removed) lists of (id, version). removed should always
    be empty — versions are never dropped — so anything in it is a bug.
    """
    old, new = _version_map(before), _version_map(after)
    added = sorted(key for key in new if key not in old)
    updated = sorted(key for key in new if key in old and new[key] != old[key])
    removed = sorted(key for key in old if key not in new)
    return added, updated, removed


def is_unchanged(before, after):
    """
    True when the merge produced nothing new. generated_at is excluded: it
    changes every run, and would otherwise force a timestamp-only commit.
    """
    strip = lambda db: {k: v for k, v in db.items() if k != "generated_at"}
    return strip(before) == strip(after)


def _duplicate_repos(solvers):
    """{repo: [id, ...]} for every non-empty repo claimed by more than one id."""
    seen = {}
    for solver in solvers:
        repo = solver.get("repo") or ""
        if repo:
            seen.setdefault(repo, []).append(solver["id"])
    return {repo: ids for repo, ids in seen.items() if len(ids) > 1}


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
        "--dry-run",
        action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args()

    before = load_database(args.database)
    after = build(before, load_results(args.results))
    output = args.output or args.database

    added, updated, removed = describe_changes(before, after)
    for solver_id, version in added:
        print(f"+ {solver_id} {version}", file=sys.stderr)
    for solver_id, version in updated:
        print(f"~ {solver_id} {version} (re-collected)", file=sys.stderr)
    for solver_id, version in removed:
        print(f"! {solver_id} {version} disappeared — this should not happen", file=sys.stderr)

    # Nothing new: leave the file exactly as it is, rather than rewriting it
    # so the only diff is a fresh generated_at.
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
