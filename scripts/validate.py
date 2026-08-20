#!/usr/bin/env python3
"""
validate.py — check a submission before anything is installed.

Everything here is a static check on the files in solvers/<id>/<version>/.
A failure means the pull request cannot be collected as submitted and the
author has to push a fix; nothing is written to the database either way.

Exits non-zero if any submission has problems, so a workflow step can gate on
it. Deliberately runs before register.py: these take milliseconds, and an
install can take half an hour.

    python3 scripts/validate.py solvers/*/*/

Testing: see tests/README.md.
"""

import argparse
import os
import re
import sys
from pathlib import Path

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# SUBMITTING.md requires this exactly: the script is executed directly, so the
# kernel needs a shebang naming an interpreter.
SHEBANG = "#!/usr/bin/env bash"


def read_solver_toml(path):
    """solver.toml as a dict, or None if it cannot be read."""
    try:
        import tomllib
    except ModuleNotFoundError:  # Python 3.10
        tomllib = None
    try:
        if tomllib:
            with path.open("rb") as handle:
                return tomllib.load(handle)
        # Good enough for the flat key = "value" file SUBMITTING.md documents.
        text = path.read_text(encoding="utf-8")
        return dict(re.findall(r'^\s*(\w+)\s*=\s*"([^"]*)"', text, re.MULTILINE))
    except (OSError, ValueError):
        return None


def check_install_script(path, version):
    """Problems with install.sh, or an empty list."""
    if not path.exists():
        return [f"{path.name} is missing"]

    problems = []
    raw = path.read_bytes()

    if b"\r\n" in raw:
        # SUBMITTING.md warns about this: CRLF fails on the runner with a
        # confusing "bad interpreter" error, so say what it really is.
        problems.append("install.sh has Windows (CRLF) line endings, must be LF")

    text = raw.decode("utf-8", errors="replace")
    first = text.splitlines()[0].strip() if text.strip() else ""
    if first != SHEBANG:
        problems.append(f"install.sh must start with {SHEBANG!r}, found {first!r}")

    if not os.access(path, os.X_OK):
        # Authoring on Windows is the usual cause: git records the bit itself,
        # and a Windows filesystem mounted under WSL reports everything as
        # executable, so `ls -l` cannot be trusted here — only `git ls-files`.
        problems.append(
            f"install.sh is not executable. Fix with: "
            f"git update-index --chmod=+x {path}"
        )

    if version not in text:
        problems.append(
            f"install.sh never mentions {version!r}, so it may install a "
            f"different release than the directory claims. Pin the version "
            f"explicitly (for example: pip install thesolver=={version})"
        )

    return problems


def check_solver_toml(path):
    """Problems with solver.toml, or an empty list."""
    if not path.exists():
        return ["solver.toml is missing"]

    data = read_solver_toml(path)
    if data is None:
        return ["solver.toml is not readable as TOML"]
    if not data.get("repo"):
        return ["solver.toml has no 'repo', which SUBMITTING.md requires"]
    return []


def validate(solver_dir):
    """Every problem with one submission directory, as a list of strings."""
    solver_dir = Path(solver_dir)
    if not solver_dir.is_dir():
        return [f"{solver_dir} is not a directory"]

    solver_id = solver_dir.parent.name
    version = solver_dir.name

    problems = []
    if not ID_PATTERN.match(solver_id):
        problems.append(
            f"id {solver_id!r} must be lowercase letters, digits and hyphens"
        )
    problems += check_install_script(solver_dir / "install.sh", version)
    problems += check_solver_toml(solver_dir / "solver.toml")
    return problems


def main():
    parser = argparse.ArgumentParser(
        description="Check submissions before anything is installed."
    )
    parser.add_argument("solver_dirs", nargs="+", help="solvers/<id>/<version>")
    args = parser.parse_args()

    failed = 0
    for solver_dir in args.solver_dirs:
        problems = validate(solver_dir)
        if not problems:
            print(f"ok  {solver_dir}")
            continue
        failed += 1
        print(f"FAIL {solver_dir}")
        for problem in problems:
            print(f"       {problem}")

    if failed:
        print(
            f"\n{failed} submission(s) cannot be collected as written. "
            f"Fix and push again.",
            file=sys.stderr,
        )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
