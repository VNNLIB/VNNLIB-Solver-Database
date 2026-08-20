#!/usr/bin/env python3
"""
Unit tests for scripts/validate.py. Pure file inspection — nothing is
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
GOOD_TOML = 'name = "TheSolver"\nrepo = "https://github.com/example/thesolver"\n'


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

    assert problems_for("repo = 'https://github.com/example/x'\n") == []
    assert any("must be a quoted URL" in p or "no 'repo'" in p
               for p in problems_for("repo = 12345\n"))
    assert any("should be a URL" in p for p in problems_for('repo = "example.com"\n'))


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
