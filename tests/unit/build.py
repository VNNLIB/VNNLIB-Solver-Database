#!/usr/bin/env python3
"""Unit tests for scripts/build.py."""

import importlib.util
import json
import pathlib
import sys
import tempfile

_SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

_spec = importlib.util.spec_from_file_location("solver_build", _SCRIPTS / "build.py")
solver_build = importlib.util.module_from_spec(_spec)
sys.modules["solver_build"] = solver_build
_spec.loader.exec_module(solver_build)

build = solver_build.build
drop_withdrawn = solver_build.drop_withdrawn
offered_versions = solver_build.offered_versions


def database_with(*entries):
    """A database holding the given (id, version) releases, all collected ok."""
    return {
        "schema_version": "2.0",
        "generated_at": "2026-01-01T00:00:00Z",
        "solvers": [
            {
                "id": solver_id,
                "name": solver_id,
                "url": f"https://example.invalid/{solver_id}",
                "versions": [
                    {
                        "version": version,
                        "collected_at": "2026-01-01T00:00:00Z",
                        "status": "ok",
                        "capabilities": {"element_types": ["real"]},
                        "satisfies": {"arithmetic": ["BND"]},
                    }
                ],
            }
            for solver_id, version in entries
        ],
    }


def record(database, solver_id):
    """The first version record of one solver in a database."""
    for solver in database["solvers"]:
        if solver["id"] == solver_id:
            return solver["versions"][0]
    raise AssertionError(f"{solver_id} not in database")


def ids(database):
    """The solver ids in a database, sorted."""
    return sorted(s["id"] for s in database["solvers"])


TOML = 'name = "x"\nurl = "https://example.invalid/x"\n'


def submission(root, solver_id, version, withdrawn=False):
    """A submission directory with a solver.toml, optionally retired."""
    directory = pathlib.Path(root) / solver_id / version
    directory.mkdir(parents=True)
    text = TOML + ("withdrawn = true\n" if withdrawn else "")
    (directory / "solver.toml").write_text(text, encoding="utf-8")
    return directory


def test_offered_versions_reads_the_directory_tree():
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0")
        submission(root, "alpha", "1.1.0")
        submission(root, "beta", "2.0.0")
        assert offered_versions(root) == {
            ("alpha", "1.0.0"),
            ("alpha", "1.1.0"),
            ("beta", "2.0.0"),
        }


def test_solver_toml_withdrawn_takes_a_release_off_offer():
    """A release is retired in place by a flag, never deleted."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0", withdrawn=True)
        submission(root, "alpha", "2.0.0")
        assert (root / "alpha" / "1.0.0").is_dir()
        assert offered_versions(root) == {("alpha", "2.0.0")}


def test_a_solver_level_toml_retires_every_version():
    """One solver.toml beside the version directories retires all of them."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0")
        submission(root, "alpha", "2.0.0")
        submission(root, "beta", "1.0.0")
        (root / "alpha" / "solver.toml").write_text(
            TOML + "withdrawn = true\n", encoding="utf-8"
        )

        assert offered_versions(root) == {("beta", "1.0.0")}


def test_solver_level_file_is_not_mistaken_for_a_version():
    """solvers/<id>/solver.toml sits where a version directory would."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0")
        (root / "alpha" / "solver.toml").write_text(TOML, encoding="utf-8")

        assert offered_versions(root) == {("alpha", "1.0.0")}


def test_a_retired_release_is_dropped_from_the_database():
    """The database describes what can be used today, so a retired release goes."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0", withdrawn=True)
        submission(root, "beta", "1.0.0")

        built = build(database_with(("alpha", "1.0.0"), ("beta", "1.0.0")), [],
                      offered=offered_versions(root))
        assert ids(built) == ["beta"]


def test_a_solver_keeps_its_other_versions():
    """Retiring one release must not take the whole solver with it."""
    database = database_with(("alpha", "1.0.0"))
    database["solvers"][0]["versions"].append(
        {"version": "2.0.0", "collected_at": "x", "status": "ok", "capabilities": {}}
    )
    built = build(database, [], offered={("alpha", "2.0.0")})

    assert ids(built) == ["alpha"]
    assert [v["version"] for v in built["solvers"][0]["versions"]] == ["2.0.0"]


def test_a_dropped_record_is_recoverable_by_re_collecting():
    """Dropping is safe because the submission stays."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        directory = submission(root, "alpha", "1.0.0", withdrawn=True)
        dropped = build(database_with(("alpha", "1.0.0")), [], offered=offered_versions(root))
        assert ids(dropped) == []

        (directory / "solver.toml").write_text(TOML, encoding="utf-8")
        collected = [{"id": "alpha", "name": "alpha", "url": "https://example.invalid/alpha",
                      "versions": [{"version": "1.0.0", "status": "ok", "capabilities": {}}]}]
        restored = build(dropped, collected, offered=offered_versions(root))
        assert ids(restored) == ["alpha"]


def test_only_clean_collections_are_published():
    """A release that did not install, or answered only some queries, is not published."""
    def entry(solver_id, status):
        """A minimal database entry for one solver with the given status."""
        record = {"version": "1.0.0", "collected_at": "x", "status": status}
        if status != "install_failed":
            record["capabilities"] = {"element_types": ["real"]}
        return {"id": solver_id, "name": solver_id, "url": f"https://e/{solver_id}",
                "versions": [record]}

    built = build({"solvers": []},
                  [entry("good", "ok"), entry("halfway", "incomplete"),
                   entry("nevercame", "install_failed")])
    assert ids(built) == ["good"]


def test_a_failed_version_does_not_take_its_siblings():
    database = database_with(("alpha", "1.0.0"))
    incoming = [{"id": "alpha", "name": "alpha", "url": "https://e/alpha", "versions": [
        {"version": "2.0.0", "collected_at": "x", "status": "install_failed",
         "errors": ["boom"]}]}]

    built = build(database, incoming)
    assert [v["version"] for v in built["solvers"][0]["versions"]] == ["1.0.0"]


def test_retire_failures_writes_the_flag_once():
    """A release that was merged and then failed to install is flagged once."""
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        directory = submission(root, "alpha", "1.0.0")
        results = [{"id": "alpha", "versions": [
            {"version": "1.0.0", "status": "install_failed", "errors": ["boom"]}]}]

        assert solver_build.retire_failures(results, root) == [directory]
        assert offered_versions(root) == set(), "no longer on offer"

        assert solver_build.retire_failures(results, root) == []
        text = (directory / "solver.toml").read_text()
        assert text.count("withdrawn") == 1, text

        assert 'url = "https://example.invalid/x"' in text


def test_retire_failures_leaves_clean_collections_alone():
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp) / "solvers"
        submission(root, "alpha", "1.0.0")
        results = [{"id": "alpha", "versions": [{"version": "1.0.0", "status": "ok"}]}]

        assert solver_build.retire_failures(results, root) == []
        assert offered_versions(root) == {("alpha", "1.0.0")}


def test_missing_solvers_directory_is_none_not_empty():
    """The distinction that matters most here."""
    assert offered_versions("/nonexistent/solvers") is None

    database = database_with(("alpha", "1.0.0"))
    built = build(database, [], offered=None)
    assert ids(built) == ["alpha"]


def test_a_vanished_directory_is_dropped_too():
    database = database_with(("alpha", "1.0.0"), ("beta", "2.0.0"))
    built = build(database, [], offered={("beta", "2.0.0")})

    assert ids(built) == ["beta"]
    assert record(built, "beta")["capabilities"] == {"element_types": ["real"]}


def test_dropping_everything_leaves_a_valid_empty_database():
    built = build(database_with(("alpha", "1.0.0")), [], offered=set())
    assert built["solvers"] == []
    assert built["schema_version"] == solver_build.schema.SCHEMA_VERSION


def test_a_release_collected_in_this_run_is_never_dropped():
    """Dropping happens after the merge, so a release collected this run survives."""
    incoming = [
        {
            "id": "gamma",
            "name": "gamma",
            "url": "",
            "versions": [{"version": "1.0.0", "status": "ok", "capabilities": {}}],
        }
    ]
    built = build(database_with(), incoming, offered={("gamma", "1.0.0")})
    assert ids(built) == ["gamma"]


def test_build_does_not_mutate_its_input():
    """build() must not touch what it was given."""
    database = database_with(("alpha", "1.0.0"))
    snapshot = json.dumps(database, sort_keys=True)

    built = build(database, [], offered=set())

    assert json.dumps(database, sort_keys=True) == snapshot, "input was modified"
    assert ids(built) == []
    assert not solver_build.is_unchanged(database, built), "change must be visible"


def test_build_returns_records_the_caller_does_not_share():
    """The assertion above only catches a mutation that has already happened."""
    database = database_with(("alpha", "1.0.0"))
    built = build(database, [], offered={("alpha", "1.0.0")})

    original = database["solvers"][0]["versions"][0]
    returned = record(built, "alpha")
    assert returned == original, "same content"
    assert returned is not original, "but must not be the same object"

    returned["status"] = "touched"
    assert original["status"] == "ok", "editing the result must not reach the input"


def test_merge_still_preserves_unknown_fields_and_other_solvers():
    database = database_with(("alpha", "1.0.0"))
    database["house_keeping"] = "unknown top-level field"
    database["solvers"][0]["maintainer_note"] = "unknown solver field"

    built = build(database, [], offered={("alpha", "1.0.0")})
    assert built["house_keeping"] == "unknown top-level field"
    assert built["solvers"][0]["maintainer_note"] == "unknown solver field"


def main():
    """Run every test_ function in this module."""
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
