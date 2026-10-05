#!/usr/bin/env python3
"""End to end: register.py -> results.jsonl -> build.py -> solvers.json."""

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

TIMEOUT = 180

EXPECTED = {
    "testsolver": ("1.0.0", "ok", True),
    "brokensolver": ("0.9.0", "incomplete", True),
    "deadsolver": ("1.0.0", "install_failed", False),
    "ghostsolver": ("1.0.0", "install_failed", False),
}

SLOW = {
    "vibecheck": ("1.1.0", "ok", True),
}

SLOW_TIMEOUT = 30 * 60

MINIMUM_PYTHON = (3, 11)


class Skipped(Exception):
    """Raised by a test that cannot run here: reported, not counted as a pass."""


def skip_reason():
    """Why this cannot run here, or None if it can."""
    if os.name == "nt":
        return "needs bash; run it under WSL"
    if shutil.which("bash") is None:
        return "bash not found on PATH"
    if importlib.util.find_spec("ensurepip") is None:
        return "ensurepip missing, so venv creation will fail (apt install python3-venv)"
    if sys.version_info[:2] < MINIMUM_PYTHON:
        running = ".".join(str(v) for v in sys.version_info[:2])
        return f"needs Python 3.12; running {running}"
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
    assert completed.returncode == 0, completed.stderr
    lines = [l for l in completed.stdout.splitlines() if l.strip()]
    assert len(lines) == 1, f"expected 1 line of JSON, got {len(lines)}"
    return json.loads(lines[0])


def run_build(results_path, database_path, *extra, solvers_dir=FIXTURES):
    """Run build.py against a temporary database and return the finished process."""
    completed = subprocess.run(
        [sys.executable, str(BUILD), str(results_path), "--database", str(database_path),
         "--solvers-dir", str(solvers_dir), *extra],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
    )
    assert completed.returncode == 0, completed.stderr
    return completed.stderr


def test_fixtures_are_valid_submissions(state):
    """Runs first: a bad fixture would fail every later test unhelpfully."""
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
        assert solver["url"] == f"https://github.com/example/{solver_id}", solver["url"]
        assert record["version"] == version, "directory name is the authority on version"
        assert record["status"] == status, f"{solver_id}: {record}"
        assert ("capabilities" in record) is has_capabilities
        if status != "ok":
            assert record["errors"], f"{solver_id} failed without saying why"

        state["solvers"].append(solver)

    testsolver = next(s for s in state["solvers"] if s["id"] == "testsolver")
    record = testsolver["versions"][0]
    assert testsolver["name"] == "TestSolver", "display name from solver.toml"
    assert record["capabilities"]["onnx_opset"] == [8, 20]
    assert record["capabilities"]["operators"]["Conv"] == ["float64", "float32"]
    assert record["capabilities"]["operators"]["Relu"] == []
    assert record["satisfies"]["arithmetic"] == ["BND", "OUTC", "LIN", "POLY"]
    assert any(n["identifier"] == "POLY" for n in record["notes"])


def test_real_solvers(state):
    """Only under --slow."""
    if not state["slow"]:
        raise Skipped("real solvers; pass --slow to include them")

    for solver_id, (version, status, has_capabilities) in SLOW.items():
        solver = run_register(FIXTURES / solver_id / version, state["workdir"], SLOW_TIMEOUT)
        record = solver["versions"][0]

        assert record["version"] == version
        assert record["status"] == status, f"{solver_id}: {record['errors']}"
        assert ("capabilities" in record) is has_capabilities
        if status != "ok":
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


PUBLISHED = sorted(i for i, (_, status, _) in EXPECTED.items() if status == "ok")


def test_build_publishes_only_clean_collections(state):
    """Only releases that collected cleanly survive the merge."""
    results = state["workdir"] / "results.jsonl"
    with results.open("w", encoding="utf-8", newline="\n") as handle:
        for solver in state["solvers"]:
            handle.write(json.dumps(solver, separators=(",", ":")) + "\n")

    database = state["workdir"] / "solvers.json"
    run_build(results, database)

    built = json.loads(database.read_text(encoding="utf-8"))
    assert built["schema_version"] == "2.0"
    assert [s["id"] for s in built["solvers"]] == PUBLISHED, (
        "incomplete and install_failed fixtures must not be published"
    )
    rendered = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "report.py"), str(results)],
        cwd=str(REPO), capture_output=True, text=True, timeout=TIMEOUT,
    ).stdout
    for solver_id in EXPECTED:
        assert solver_id in rendered, f"{solver_id} missing from the pull request report"

    state["database"] = database
    state["results"] = results


def test_second_build_is_a_no_op(state):
    """Same input twice must not touch the file, not even generated_at."""
    before = state["database"].read_bytes()
    log = run_build(state["results"], state["database"])
    assert state["database"].read_bytes() == before, "database was rewritten with no changes"
    assert "no changes" in log


def test_recollecting_replaces_and_new_version_appends(state):
    """SUBMITTING.md's "Updating": overwrite the version, keep the old ones."""
    submissions = state["workdir"] / "updating"
    shutil.copytree(FIXTURES / "testsolver", submissions / "testsolver")
    shutil.copytree(submissions / "testsolver" / "1.0.0", submissions / "testsolver" / "1.2.0")

    solver = json.loads(json.dumps(next(s for s in state["solvers"] if s["id"] == "testsolver")))
    database = state["workdir"] / "updating.json"

    first = state["workdir"] / "first.jsonl"
    first.write_text(json.dumps(solver) + "\n", encoding="utf-8")
    run_build(first, database, solvers_dir=submissions)

    solver["versions"][0]["capabilities"]["element_types"] = ["real"]
    recollect = state["workdir"] / "recollect.jsonl"
    recollect.write_text(json.dumps(solver) + "\n", encoding="utf-8")
    run_build(recollect, database, solvers_dir=submissions)

    solver = json.loads(json.dumps(solver))
    solver["versions"][0]["version"] = "1.2.0"
    newer = state["workdir"] / "newer.jsonl"
    newer.write_text(json.dumps(solver) + "\n", encoding="utf-8")
    run_build(newer, database, solvers_dir=submissions)

    built = json.loads(database.read_text(encoding="utf-8"))
    testsolver = next(s for s in built["solvers"] if s["id"] == "testsolver")
    assert [v["version"] for v in testsolver["versions"]] == ["1.0.0", "1.2.0"]
    assert testsolver["versions"][0]["capabilities"]["element_types"] == ["real"], (
        "re-collecting replaces the record rather than duplicating it"
    )


def test_a_failed_release_is_retired_in_place(state):
    """A release that fails on main is merged in error."""
    submissions = state["workdir"] / "solvers"
    shutil.copytree(FIXTURES / "deadsolver", submissions / "deadsolver")
    toml = submissions / "deadsolver" / "1.0.0" / "solver.toml"
    assert "withdrawn = false" in toml.read_text(encoding="utf-8"), (
        "this fixture deliberately carries the optional field, so the test "
        "exercises retire replacing an existing line rather than adding one. "
        "The other fixtures leave it out, which is the normal case now"
    )

    failed = next(s for s in state["solvers"] if s["id"] == "deadsolver")
    results = state["workdir"] / "failed.jsonl"
    results.write_text(json.dumps(failed) + "\n", encoding="utf-8")

    database = state["workdir"] / "retire.json"
    subprocess.run(
        [sys.executable, str(BUILD), str(results), "--database", str(database),
         "--solvers-dir", str(submissions), "--retire-failed"],
        cwd=str(REPO), capture_output=True, text=True, timeout=TIMEOUT, check=True,
    )

    retired = toml.read_text(encoding="utf-8")
    assert "withdrawn = true" in retired
    assert retired.count("withdrawn") == 1, retired

    spec = importlib.util.spec_from_file_location(
        "retire_check_validate", REPO / "scripts" / "validate.py"
    )
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    assert checker.is_withdrawn(toml.parent) is True, (
        "the file the pipeline wrote must still read back as retired"
    )
    assert not database.exists(), "a run with nothing to publish must write nothing"


def test_hand_written_fields_survive(state):
    """Fields build.py does not know about survive a collection."""
    built = json.loads(state["database"].read_text(encoding="utf-8"))
    built["house_keeping"] = "unknown top-level field"
    for solver in built["solvers"]:
        if solver["id"] == "testsolver":
            solver["maintainer_note"] = "unknown solver field"
            solver["url"] = "https://example.invalid/edited-by-hand"
    state["database"].write_text(json.dumps(built, indent=2) + "\n", encoding="utf-8")

    run_build(state["results"], state["database"])

    built = json.loads(state["database"].read_text(encoding="utf-8"))
    testsolver = next(s for s in built["solvers"] if s["id"] == "testsolver")
    assert built["house_keeping"] == "unknown top-level field"
    assert testsolver["maintainer_note"] == "unknown solver field"
    assert testsolver["url"] == "https://github.com/example/testsolver"


def test_no_environments_left_behind(state):
    """register.py promises the venv does not outlive the call."""
    leftovers = list(Path(tempfile.gettempdir()).glob("register-*"))
    assert leftovers == [], f"temp environments survived: {leftovers}"


def real_database():
    """The committed database, or None if it isn't there."""
    path = REPO / "data" / "solvers.json"
    return path.read_bytes() if path.exists() else None


def test_real_database_untouched(state):
    """Nothing in this file may write to data/solvers.json, or create it."""
    assert real_database() == state["real_database"]


def main():
    """Run the suite, skipping where the environment cannot support it."""
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
        ordered = [
            test_fixtures_are_valid_submissions,
            test_register_every_fixture,
            test_install_failed_names_the_cause,
            test_build_publishes_only_clean_collections,
            test_second_build_is_a_no_op,
            test_recollecting_replaces_and_new_version_appends,
            test_a_failed_release_is_retired_in_place,
            test_hand_written_fields_survive,
            test_no_environments_left_behind,
            test_real_database_untouched,
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
