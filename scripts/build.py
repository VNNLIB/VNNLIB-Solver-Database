#!/usr/bin/env python3
"""
build.py: fold the records register.py produced into data/solvers.json.

register.py writes one Solver entry per line to results.jsonl; this merges
those into the database on disk. It never installs or queries anything.

A merge, never a regeneration. The database on disk is the starting point and
a run only adds to it or replaces the exact versions it collected, per
SUBMITTING.md's "Updating":

  - re-collecting a version OVERWRITES it, it does not duplicate
  - a solver absent from results.jsonl is left exactly as it was
  - unrecognised top-level fields are carried through
  - if nothing changed, the file is not rewritten, so a no-op leaves no diff

Only releases that collected cleanly are published. A release that could not
be installed, or answered only some of the eleven queries, has nothing to
advertise, so its record is dropped; the author still sees exactly what
happened in the pull request comment.

Submissions are never deleted from this repository. A release is retired by
setting `withdrawn = true` in its solver.toml, or every release of a solver at
once by setting it in `solvers/<id>/solver.toml`. Its record is then removed
too, so what is published describes only what can be used today. The
submission itself stays, so clearing the line and re-collecting brings the
record back.

Testing: see tests/README.md.
"""

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
            # Shape-checked here so a malformed record fails by name. Reaching
            # the merge with a version that has no "version" key would be a
            # KeyError traceback naming nothing useful.
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
    contract, because consumers compute ranges from the ordering alone.
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


def offered_versions(solvers_dir):
    """
    {(id, version)} for every release still on offer, or None if solvers/ is
    not there at all.

    A release is on offer when its directory exists and neither its own
    solver.toml nor the one beside it at `solvers/<id>/solver.toml` says
    `withdrawn = true`. Submissions are never deleted from this repository, so
    the flag in the file is the mechanism; a directory that has gone anyway is
    treated as withdrawn too, which costs nothing and stops a record claiming a
    solver is available when its submission has vanished.

    The solver-level file retires every release at once, for a project that has
    been abandoned rather than a single release being superseded. Either file
    saying so is enough: they are two ways to answer the same question, not two
    conditions to satisfy.

    None and "empty" are kept apart on purpose: a missing solvers/ means the
    caller cannot tell us what is registered, and emptying the entire database
    on that basis would be a disaster dressed as a feature.
    """
    solvers_dir = Path(solvers_dir)
    if not solvers_dir.is_dir():
        return None

    offered = set()
    for solver in sorted(solvers_dir.iterdir()):
        if not solver.is_dir():
            continue
        # A solver.toml beside the version directories retires every release
        # at once, for a project that has been abandoned rather than one
        # release being superseded.
        if validate.is_withdrawn(solver):
            continue
        for version in sorted(solver.iterdir()):
            if version.is_dir() and not validate.is_withdrawn(version):
                offered.add((solver.name, version.name))
    return offered


def retire_failures(results, solvers_dir):
    """
    Mark every release in `results` that did not collect cleanly as withdrawn,
    by writing the flag into its own solver.toml.

    A release that fails to install on main was merged in error, and without
    this the pipeline reinstalls it on every push that touches it, half an hour
    at a time, to reach the same conclusion. Writing the flag into the
    repository also makes the state reviewable: it shows up as a commit and can
    be undone by deleting the line.

    Returns the directories it changed.
    """
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
    """
    Remove every release that did not collect cleanly, and any solver left
    with none.

    The database advertises what a solver can do, so a release that could not
    be installed, or answered only some of the eleven queries, has nothing to
    advertise. Publishing it would invite a reader to draw conclusions from a
    partial measurement.

    The author still finds out: the pull request comment reports exactly what
    happened, errors and all, which is where that information is useful. It is
    feedback, not a catalogue entry.
    """
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
    """
    Remove every release that is no longer on offer, and any solver left with
    no releases at all.

    The client wants a retired release gone from the database rather than
    flagged, so what is published describes only what can be used today.

    This is the one place the database is not append-only, and it is safe
    because the submission itself is not deleted: `solvers/<id>/<version>/`
    still holds the install script, so clearing the `withdrawn` line and
    re-collecting reproduces the record. Nothing that took half an hour to
    measure becomes unrecoverable, it only stops being published.

    Pass None for `offered` to leave the database alone.
    """
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
    """
    A new database with every entry in results merged in, keyed by id (the
    directory name, which never changes). repo is SCHEMA.md's key for
    detecting the same solver submitted twice, which is warned about below.

    `offered` is the set of (id, version) pairs still on offer. Anything in the
    database and not in that set is dropped. Pass None to leave the database
    alone.
    """
    # Deep-copied, because this function must not touch what it was given.
    # Marking withdrawal edits records in place, and without the copy those
    # edits would land on the caller's `before` as well, leaving main() to
    # compare a structure against itself and conclude nothing had changed.
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

    # After the merge, so a release collected in this very run is never dropped
    # on the strength of a stale directory listing.
    by_id = drop_withdrawn(by_id, offered)
    by_id = drop_incomplete(by_id)

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
    (added, updated, removed) lists of (id, version). `removed` is how a
    retirement shows up: the release is no longer on offer, so its record has
    been dropped.
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
        # Two different things end a record, and a maintainer reading the log
        # needs to tell them apart: someone set `withdrawn = true`, or the
        # submission directory is not there any more. The second is rare and
        # deliberate, so it should not look like the routine case.
        gone = args.solvers_dir and not (Path(args.solvers_dir) / solver_id / version).is_dir()
        why = "submission deleted" if gone else "retired"
        print(f"- {solver_id} {version} ({why})", file=sys.stderr)

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
