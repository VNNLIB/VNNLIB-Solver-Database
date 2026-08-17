#!/usr/bin/env python3
"""
End-to-end test of the whole pipeline: register.py -> results.jsonl ->
build.py -> solvers.json, driven by the fixtures in tests/fixtures.

Unlike tests/unit/collect.py this one is real: it builds a venv per solver,
executes the submitted install.sh, runs the installed binary, and writes a
database. That makes it slow (a few seconds per fixture) and platform-bound,
so it skips rather than fails where it cannot run.

    python3 tests/integration/pipeline.py           # fakes only, ~8s, offline
    python3 tests/integration/pipeline.py --slow    # also the real solvers

Without --slow only the fixtures in EXPECTED run: fakes that install in
milliseconds and whose outcome depends on nothing but this repo. --slow adds
SLOW, which reaches PyPI and pulls torch, so it can go red for reasons that
have nothing to do with the code here.

Nothing outside a temporary directory is written — data/solvers.json is never
touched.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "tests" / "fixtures"
REGISTER = REPO / "scripts" / "register.py"
BUILD = REPO / "scripts" / "build.py"

# install.sh is trivial in every fixture; this only needs to be long enough to
# survive a slow venv creation on a loaded machine.
TIMEOUT = 180

# What each fixture is supposed to demonstrate, and whether a record for it
# should carry capabilities at all. SCHEMA.md's rule is to read the absence of
# capabilities rather than the status string, so both are asserted.
EXPECTED = {
    "testsolver": ("1.0.0", "ok", True),
    "brokensolver": ("0.9.0", "incomplete", True),
    "deadsolver": ("1.0.0", "install_failed", False),
    "ghostsolver": ("1.0.0", "install_failed", False),
}

# Real solvers: network, minutes, and an outcome that depends on PyPI rather
# than on this repo. Only run under --slow, so a normal run cannot go red
# because someone else's package broke.
#
# vibecheck expects install_failed because it currently IS uninstallable:
# both releases pin onnxruntime==1.26.0, which is not published. When that is
# fixed upstream, change this to "ok" — a failure here is then a real signal
# rather than noise.
SLOW = {
    "vibecheck": ("1.1.0", "ok", True),
}

# install.sh for a real solver pulls torch; 180s is not enough.
SLOW_TIMEOUT = 30 * 60


class Skipped(Exception):
    """Raised by a test that cannot run here — reported, not counted as a pass."""


def skip_reason():
    """Why this cannot run here, or None if it can."""
    if os.name == "nt":
        return "needs bash; run it under WSL"
    if shutil.which("bash") is None:
        return "bash not found on PATH"
    if importlib.util.find_spec("ensurepip") is None:
        return "ensurepip missing, so venv creation will fail (apt install python3-venv)"
    return None


def run_register(fixture_dir, workdir, timeout=TIMEOUT):
    """One register.py run. Returns the parsed Solver entry."""
    completed = subprocess.run(
        [sys.executable, str(REGISTER), str(fixture_dir), "--timeout", str(timeout)],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    # Always 0, even for install_failed: a recorded failure is not a broken run.
    assert completed.returncode == 0, completed.stderr
    lines = [l for l in completed.stdout.splitlines() if l.strip()]
    # Exactly one line, or `>> results.jsonl` stops being valid JSON Lines.
    assert len(lines) == 1, f"expected 1 line of JSON, got {len(lines)}"
    return json.loads(lines[0])


def run_build(results_path, database_path, *extra):
    completed = subprocess.run(
        [sys.executable, str(BUILD), str(results_path), "--database", str(database_path), *extra],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
    )
    assert completed.returncode == 0, completed.stderr
    return completed.stderr


def test_fixtures_are_valid_submissions(state):
    """
    Runs first, because a fixture that fails validation fails every test after
    it in a way that says nothing useful. The case this exists for: git records
    the executable bit separately from the filesystem, so a fixture committed
    as mode 644 works locally and fails on a runner with Permission denied.
    """
    spec = importlib.util.spec_from_file_location("solver_validate", REPO / "scripts" / "validate.py")
    validate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validate)

    for solver_id, (version, _, _) in {**EXPECTED, **SLOW}.items():
        problems = validate.validate(FIXTURES / solver_id / version)
        assert problems == [], f"{solver_id} {version}: {problems}"


def test_register_every_fixture(state):
    """Each fixture reaches the status it was written to demonstrate."""
    for solver_id, (version, status, has_capabilities) in EXPECTED.items():
        solver = run_register(FIXTURES / solver_id / version, state["workdir"])
        record = solver["versions"][0]

        assert solver["id"] == solver_id
        # repo comes from solver.toml, so it is filled even when the install
        # failed and nothing was ever queried.
        assert solver["repo"] == f"https://github.com/example/{solver_id}", solver["repo"]
        assert record["version"] == version, "directory name is the authority on version"
        assert record["status"] == status, f"{solver_id}: {record}"
        assert ("capabilities" in record) is has_capabilities
        if status != "ok":
            assert record["errors"], f"{solver_id} failed without saying why"

        state["solvers"].append(solver)

    # The one fully conforming fixture is worth checking in detail.
    testsolver = next(s for s in state["solvers"] if s["id"] == "testsolver")
    record = testsolver["versions"][0]
    assert testsolver["name"] == "TestSolver", "display name from solver.toml"
    assert record["capabilities"]["onnx_opset"] == [8, 20]
    assert record["satisfies"]["arithmetic"] == ["BND", "OUTC", "LIN", "POLY"]
    assert any(n["identifier"] == "POLY" for n in record["notes"])


def test_real_solvers(state):
    """
    Only under --slow. Same assertions as the fakes, but the outcome depends
    on PyPI, so it stays out of the default run.
    """
    if not state["slow"]:
        raise Skipped("real solvers; pass --slow to include them")

    for solver_id, (version, status, has_capabilities) in SLOW.items():
        solver = run_register(FIXTURES / solver_id / version, state["workdir"], SLOW_TIMEOUT)
        record = solver["versions"][0]

        assert record["version"] == version
        assert record["status"] == status, f"{solver_id}: {record['errors']}"
        assert ("capabilities" in record) is has_capabilities
        if status != "ok":
            # The whole point of raising OUTPUT_TAIL_LINES: a failure the
            # submitter can act on, not just the fact that one happened.
            assert record["errors"][0].strip(), f"{solver_id} failed without saying why"


def test_install_failed_names_the_cause(state):
    """A submitter must be told which of the three failures they hit."""
    errors = {
        s["id"]: " ".join(s["versions"][0]["errors"])
        for s in state["solvers"]
        if s["versions"][0]["status"] == "install_failed"
    }
    assert "exited 1" in errors["deadsolver"], errors["deadsolver"]
    assert "no executable" in errors["ghostsolver"], errors["ghostsolver"]


def test_build_merges_results(state):
    """register's JSON Lines feed straight into build with nothing in between."""
    results = state["workdir"] / "results.jsonl"
    with results.open("w", encoding="utf-8", newline="\n") as handle:
        for solver in state["solvers"]:
            handle.write(json.dumps(solver, separators=(",", ":")) + "\n")

    database = state["workdir"] / "solvers.json"
    run_build(results, database)

    built = json.loads(database.read_text(encoding="utf-8"))
    assert built["schema_version"] == "1.0"
    assert [s["id"] for s in built["solvers"]] == sorted(EXPECTED)
    state["database"] = database
    state["results"] = results


def test_second_build_is_a_no_op(state):
    """Same input twice must not touch the file — not even generated_at."""
    before = state["database"].read_bytes()
    log = run_build(state["results"], state["database"])
    assert state["database"].read_bytes() == before, "database was rewritten with no changes"
    assert "no changes" in log


def test_recollecting_replaces_and_new_version_appends(state):
    """SUBMITTING.md's "Updating": overwrite the version, keep the old ones."""
    solver = json.loads(json.dumps(next(s for s in state["solvers"] if s["id"] == "testsolver")))

    # Same version, collected again with a different outcome.
    solver["versions"][0]["status"] = "incomplete"
    solver["versions"][0]["errors"] = ["--name: produced no output"]
    recollect = state["workdir"] / "recollect.jsonl"
    recollect.write_text(json.dumps(solver) + "\n", encoding="utf-8")
    run_build(recollect, state["database"])

    # A later release of the same solver.
    solver = json.loads(json.dumps(solver))
    solver["versions"][0]["version"] = "1.2.0"
    solver["versions"][0]["status"] = "ok"
    newer = state["workdir"] / "newer.jsonl"
    newer.write_text(json.dumps(solver) + "\n", encoding="utf-8")
    run_build(newer, state["database"])

    built = json.loads(state["database"].read_text(encoding="utf-8"))
    testsolver = next(s for s in built["solvers"] if s["id"] == "testsolver")
    versions = [(v["version"], v["status"]) for v in testsolver["versions"]]
    assert versions == [("1.0.0", "incomplete"), ("1.2.0", "ok")], versions
    # Everyone else is untouched by a run that never mentioned them.
    assert [s["id"] for s in built["solvers"]] == sorted(EXPECTED)


def test_hand_written_fields_survive(state):
    """
    Fields build.py does not know about survive a collection. Fields it does
    know about are refreshed from the submission, which is the point of
    collecting them.
    """
    built = json.loads(state["database"].read_text(encoding="utf-8"))
    built["house_keeping"] = "unknown top-level field"
    for solver in built["solvers"]:
        if solver["id"] == "testsolver":
            solver["maintainer_note"] = "unknown solver field"
            solver["repo"] = "https://example.invalid/edited-by-hand"
    state["database"].write_text(json.dumps(built, indent=2) + "\n", encoding="utf-8")

    run_build(state["results"], state["database"])

    built = json.loads(state["database"].read_text(encoding="utf-8"))
    testsolver = next(s for s in built["solvers"] if s["id"] == "testsolver")
    assert built["house_keeping"] == "unknown top-level field"
    assert testsolver["maintainer_note"] == "unknown solver field"
    # repo now has a source — solver.toml — so the collected value wins over
    # a hand edit rather than being overwritten by an empty string.
    assert testsolver["repo"] == "https://github.com/example/testsolver"


def test_no_environments_left_behind(state):
    """register.py promises the venv does not outlive the call."""
    leftovers = list(Path(tempfile.gettempdir()).glob("register-*"))
    assert leftovers == [], f"temp environments survived: {leftovers}"


def real_database():
    """
    The committed database, or None if it isn't there. Absent is a legitimate
    state — a fresh clone before the first collection — and must not stop the
    tests from running.
    """
    path = REPO / "data" / "solvers.json"
    return path.read_bytes() if path.exists() else None


def test_real_database_untouched(state):
    """Nothing in this file may write to data/solvers.json — or create it."""
    assert real_database() == state["real_database"]


def main():
    slow = "--slow" in sys.argv[1:]

    reason = skip_reason()
    if reason:
        print(f"SKIPPED: {reason}")
        return 0

    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    with tempfile.TemporaryDirectory(prefix="pipeline-test-") as tmp:
        state = {
            "workdir": Path(tmp),
            "solvers": [],
            "slow": slow,
            "real_database": real_database(),
        }
        # Ordered by definition, not alphabetically: each step builds on the
        # state the previous one left.
        ordered = [
            test_fixtures_are_valid_submissions,
            test_register_every_fixture,
            test_install_failed_names_the_cause,
            test_build_merges_results,
            test_second_build_is_a_no_op,
            test_recollecting_replaces_and_new_version_appends,
            test_hand_written_fields_survive,
            test_no_environments_left_behind,
            test_real_database_untouched,
            # Last: it is the slowest, and nothing else depends on its state.
            test_real_solvers,
        ]
        assert len(ordered) == len(tests), "a test was defined but not ordered"

        passed = skipped = 0
        for test in ordered:
            try:
                test(state)
            except Skipped as reason:
                print(f"--  {test.__name__} skipped ({reason})")
                skipped += 1
                continue
            print(f"ok  {test.__name__}")
            passed += 1

    print(f"\n{passed} passed, {skipped} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
