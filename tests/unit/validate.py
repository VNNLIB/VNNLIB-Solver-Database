#!/usr/bin/env python3
"""
Unit tests for scripts/validate.py. Pure file inspection, and nothing is
installed, so these run anywhere in milliseconds.

    python3 tests/unit/validate.py
"""

import importlib.util
import pathlib
import sys
import tempfile

_SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

_spec = importlib.util.spec_from_file_location("solver_validate", _SCRIPTS / "validate.py")
solver_validate = importlib.util.module_from_spec(_spec)
sys.modules["solver_validate"] = solver_validate
_spec.loader.exec_module(solver_validate)

validate = solver_validate.validate

GOOD_SCRIPT = '#!/usr/bin/env bash\nset -euo pipefail\npip install thesolver==1.2.0\n'
# Split, because `withdrawn` is required but several tests need to supply their
# own value for it, and appending a second one would be a duplicate key rather
# than an override.
BARE_TOML = 'name = "TheSolver"\nrepo = "https://github.com/example/thesolver"\n'
GOOD_TOML = BARE_TOML + "withdrawn = false\n"


def make_submission(tmp, solver_id="thesolver", version="1.2.0",
                    script=GOOD_SCRIPT, toml=GOOD_TOML, executable=True):
    """A submission directory on disk, valid unless an argument says otherwise."""
    directory = pathlib.Path(tmp) / solver_id / version
    directory.mkdir(parents=True)
    if script is not None:
        path = directory / "install.sh"
        path.write_bytes(script.encode() if isinstance(script, str) else script)
        path.chmod(0o755 if executable else 0o644)
    if toml is not None:
        (directory / "solver.toml").write_text(toml, encoding="utf-8")
    return directory


def test_valid_submission_has_no_problems():
    with tempfile.TemporaryDirectory() as tmp:
        assert validate(make_submission(tmp)) == []


def test_version_must_appear_in_install_script():
    """The case this was written for: directory 1.2.0, script pinning 1.1.0."""
    script = GOOD_SCRIPT.replace("1.2.0", "1.1.0")
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, script=script))
    assert len(problems) == 1
    assert "never mentions '1.2.0'" in problems[0]


def test_unpinned_install_is_caught_too():
    script = "#!/usr/bin/env bash\npip install thesolver\n"
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, script=script))
    assert any("never mentions" in p for p in problems)


def test_crlf_and_shebang():
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, script=GOOD_SCRIPT.replace("\n", "\r\n")))
    assert any("CRLF" in p for p in problems)

    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, script="#!/bin/sh\npip install thesolver==1.2.0\n"))
    assert any("must start with" in p for p in problems)


def test_missing_pieces():
    with tempfile.TemporaryDirectory() as tmp:
        assert any("install.sh is missing" in p for p in validate(make_submission(tmp, script=None)))
    with tempfile.TemporaryDirectory() as tmp:
        assert any("solver.toml is missing" in p for p in validate(make_submission(tmp, toml=None)))
    with tempfile.TemporaryDirectory() as tmp:
        assert any("no 'repo'" in p for p in validate(make_submission(tmp, toml='name = "X"\n')))
    with tempfile.TemporaryDirectory() as tmp:
        assert any("not executable" in p for p in validate(make_submission(tmp, executable=False)))


def test_id_must_be_url_safe():
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, solver_id="The Solver"))
    assert any("lowercase letters" in p for p in problems)


def test_install_script_that_is_not_a_file():
    """A directory named install.sh used to raise IsADirectoryError."""
    with tempfile.TemporaryDirectory() as tmp:
        directory = pathlib.Path(tmp) / "thesolver" / "1.2.0"
        directory.mkdir(parents=True)
        (directory / "install.sh").mkdir()
        (directory / "solver.toml").write_text(GOOD_TOML, encoding="utf-8")
        assert validate(directory) == ["install.sh is not a file"]


def test_repo_must_be_a_quoted_url():
    """
    Typed explicitly because the two TOML readers disagree otherwise: tomllib
    returns `repo = 12345` as an int, the 3.10 regex fallback sees no quoted
    string at all. Same submission, different verdict per interpreter.
    """
    def problems_for(toml):
        with tempfile.TemporaryDirectory() as tmp:
            return validate(make_submission(tmp, toml=toml))

    assert problems_for("repo = 'https://github.com/example/x'\nwithdrawn = false\n") == []
    assert any("must be a quoted URL" in p or "no 'repo'" in p
               for p in problems_for("repo = 12345\n"))
    assert any("should be a URL" in p for p in problems_for('repo = "example.com"\n'))


def test_withdrawn_submissions_skip_the_checks():
    """
    A retired release is never installed again, so nothing about it needs
    checking. Its install script may well have stopped working, which is often
    exactly why it was retired.
    """
    broken = "#!/bin/sh\necho no version here\n"
    with tempfile.TemporaryDirectory() as tmp:
        directory = make_submission(tmp, script=broken, toml=GOOD_TOML)
        assert solver_validate.is_offered(directory) is True
        assert validate(directory) != [], "a broken script should fail while offered"

        (directory / "solver.toml").write_text(
            BARE_TOML + "withdrawn = true\n", encoding="utf-8"
        )
        assert solver_validate.is_offered(directory) is False


def test_a_retired_solver_takes_its_versions_out_of_scope():
    """A solver.toml one level up retires everything under it."""
    with tempfile.TemporaryDirectory() as tmp:
        directory = make_submission(tmp)
        assert solver_validate.is_offered(directory) is True

        (directory.parent / "solver.toml").write_text(
            BARE_TOML + "withdrawn = true\n", encoding="utf-8"
        )
        assert solver_validate.is_offered(directory) is False


def test_withdrawn_must_be_a_boolean():
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, toml=BARE_TOML + 'withdrawn = "true"\n'))
    assert any("must be true or false" in p for p in problems), problems


def test_capitalised_boolean_is_rejected_not_ignored():
    """
    TOML booleans are lowercase. `withdrawn = True` is a syntax error, and
    tomllib refuses the whole file. The 3.10 fallback used to skip the line
    quietly instead, which left a release published locally and its pull
    request rejected in CI.
    """
    with tempfile.TemporaryDirectory() as tmp:
        directory = make_submission(tmp, toml=BARE_TOML + "withdrawn = True\n")
        assert solver_validate.read_solver_toml(directory / "solver.toml") is None
        assert solver_validate.is_offered(directory) is True, "still offered, not silently retired"

        problems = validate(directory)
        assert any("lowercase" in p for p in problems), problems


def test_toml_fallback_agrees_with_tomllib_on_booleans():
    """
    The 3.10 fallback has to read `withdrawn = true` as a boolean. Reading it
    as absent there while CI reads it as True would mean a retired solver
    looked retired on the runner and available on a developer's machine.
    """
    with tempfile.TemporaryDirectory() as tmp:
        path = pathlib.Path(tmp) / "solver.toml"
        path.write_text(BARE_TOML + "withdrawn = true\n", encoding="utf-8")
        assert solver_validate.read_solver_toml(path)["withdrawn"] is True

        path.write_text(GOOD_TOML, encoding="utf-8")
        assert solver_validate.read_solver_toml(path)["withdrawn"] is False


def test_retire_replaces_the_template_line_instead_of_duplicating_it():
    """
    SUBMITTING.md ships `withdrawn = false` in the template, so most files
    already have the key. Appending a second one would make the file invalid
    TOML, which tomllib refuses outright: the release the pipeline had just
    decided to retire would read as not retired and be reinstalled on the next
    push. The whole point of retiring it is that this stops happening.
    """
    with tempfile.TemporaryDirectory() as tmp:
        directory = make_submission(tmp, toml=GOOD_TOML)

        assert solver_validate.retire(directory) is True
        text = (directory / "solver.toml").read_text(encoding="utf-8")
        assert text.count("withdrawn") == 1, text
        assert "withdrawn = true" in text
        assert solver_validate.read_solver_toml(directory / "solver.toml") is not None
        assert solver_validate.is_withdrawn(directory) is True
        assert solver_validate.is_offered(directory) is False

        # The author's other fields are not collateral damage.
        assert 'repo = "https://github.com/example/thesolver"' in text

        # And a second pass is a no-op rather than another line.
        assert solver_validate.retire(directory) is False
        assert (directory / "solver.toml").read_text(encoding="utf-8") == text


def test_retire_appends_when_the_key_is_absent():
    """
    Validation now requires `withdrawn`, so a submission reaching this path has
    already been rejected. `retire()` still handles it, because it is also
    called on files nobody validated: the solver-level solver.toml, and
    anything written before the field was required.
    """
    with tempfile.TemporaryDirectory() as tmp:
        directory = make_submission(tmp, toml=BARE_TOML)
        assert solver_validate.retire(directory) is True
        assert solver_validate.is_withdrawn(directory) is True


def test_withdrawn_is_required_not_defaulted():
    """
    The field has to be present so retiring a release is a one-character diff
    on a line a reviewer can already see, rather than a new key appearing.
    """
    with tempfile.TemporaryDirectory() as tmp:
        problems = validate(make_submission(tmp, toml=BARE_TOML))
    assert any("no 'withdrawn'" in p for p in problems), problems
    assert any("withdrawn = false" in p for p in problems), problems


def test_missing_directory_is_reported_not_raised():
    assert validate("/nonexistent/solver/1.0.0") == [
        "/nonexistent/solver/1.0.0 is not a directory"
    ]


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
