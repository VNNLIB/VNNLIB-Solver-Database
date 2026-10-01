#!/usr/bin/env python3
"""
validate.py: static checks on solvers/<id>/<version>/, before anything is
installed.

Exits non-zero if any submission has problems, so a workflow step can gate on
it. Runs before register.py: these take milliseconds, an install can take half
an hour.

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
        # Python 3.10 has no tomllib. Good enough for the flat file
        # SUBMITTING.md documents, and it has to agree with tomllib on every
        # value that changes a decision: a quoted string in either quote style,
        # and an unquoted true/false. Reading `withdrawn = true` as absent here
        # while CI reads it as a boolean would mean a retired solver looked
        # retired on the runner and available on a developer's machine.
        text = path.read_text(encoding="utf-8")
        data = {}
        for key, quoted, bare in re.findall(
            r"""^\s*(\w+)\s*=\s*(?:["']([^"']*)["']|(\S+))\s*$""", text, re.MULTILINE
        ):
            if not bare:
                data[key] = quoted
            elif bare in ("true", "false"):
                data[key] = bare == "true"
            elif bare.isdigit():
                data[key] = int(bare)
            else:
                # Anything else is not valid TOML, and tomllib would refuse the
                # whole file. `withdrawn = True` is the case that matters:
                # capitalised, it is not a TOML boolean. Skipping it quietly
                # here would leave a release published on a 3.10 machine and
                # rejected in CI.
                return None
        return data
    except (OSError, ValueError):
        return None


def check_install_script(path, version):
    """Problems with install.sh, or an empty list."""
    if not path.exists():
        return [f"{path.name} is missing"]
    if not path.is_file():
        return ["install.sh is not a file"]

    problems = []
    try:
        raw = path.read_bytes()
    except OSError as exc:
        return [f"install.sh could not be read: {exc}"]

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
        # executable, so `ls -l` cannot be trusted here, only `git ls-files`.
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
        # The commonest cause by far, and the least obvious to whoever wrote
        # it: TOML booleans are lowercase, so `withdrawn = True` is a syntax
        # error rather than a value.
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"=\s*(True|False)\b", text):
            return [
                "solver.toml is not readable as TOML: booleans are lowercase, "
                "write `withdrawn = true` rather than `True`"
            ]
        return ["solver.toml is not readable as TOML"]

    url = data.get("url")
    if not url:
        return ["solver.toml has no 'url', which SUBMITTING.md requires"]
    # Typed explicitly, because the two readers disagree otherwise: tomllib
    # returns `url = 12345` as an int, while the regex fallback used on
    # Python 3.10 sees no quoted string and reports it missing. Same
    # submission, different verdict depending on the interpreter.
    if not isinstance(url, str):
        return [
            f"solver.toml 'url' must be a quoted URL, "
            f"got {type(url).__name__}"
        ]
    if not url.startswith(("http://", "https://")):
        return [f"solver.toml 'url' should be a URL, got {url!r}"]

    if "withdrawn" in data:
        withdrawn = data["withdrawn"]
        if not isinstance(withdrawn, bool):
            # A string "true" would be truthy here and falsy in a TOML reader
            # that types it properly, so the two could disagree about whether a
            # solver is still offered. Better to reject it.
            return [
                f"solver.toml 'withdrawn' must be true or false, "
                f"got {withdrawn!r}"
            ]
    # Absent is false: a submission is an offer to install the solver, so the
    # default is the state every new one is in.
    return []


def is_withdrawn(directory):
    """
    Whether the solver.toml in this directory retires what it covers.

    Works at either level: in `solvers/<id>/<version>/` it retires that one
    release, in `solvers/<id>/` every release of that solver.

    Absent means false, and so does an unreadable or missing file. That is the
    safe direction: treating an unparseable file as retired would silently
    remove a solver that is only misspelled. `validate` reports it as broken.
    """
    data = read_solver_toml(Path(directory) / "solver.toml") or {}
    return data.get("withdrawn") is True


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


def retire(solver_dir):
    """
    Write `withdrawn = true` into this submission's solver.toml.

    Used when a merged release turns out not to install, so the pipeline stops
    reinstalling something already known to be broken.

    Returns True if the file changed, and does nothing if the flag is already
    true. Any existing `withdrawn` line is removed before the new one is
    written, never appended to: a key twice is not valid TOML, the file would
    stop parsing, and the release just retired would read as live again.
    """
    solver_dir = Path(solver_dir)
    path = solver_dir / "solver.toml"
    if not path.is_file() or is_withdrawn(solver_dir):
        return False

    lines = path.read_text(encoding="utf-8").splitlines()
    kept = [
        line
        for line in lines
        if not re.match(r"^[ \t]*withdrawn[ \t]*=", line)
    ]
    kept.append("withdrawn = true")
    path.write_text("\n".join(kept) + "\n", encoding="utf-8", newline="\n")
    return True


def is_offered(solver_dir):
    """
    Whether this submission still needs installing and collecting.

    False for a directory that is gone, for one that declares
    `withdrawn = true`, and for one whose solver has been retired as a whole.
    A retired release is not installed again, so nothing about it needs
    checking: its install script may well have stopped working, which is often
    exactly why it was retired.
    """
    solver_dir = Path(solver_dir)
    if not solver_dir.is_dir():
        return False
    return not is_withdrawn(solver_dir) and not is_withdrawn(solver_dir.parent)


def main():
    parser = argparse.ArgumentParser(
        description="Check submissions before anything is installed."
    )
    parser.add_argument("solver_dirs", nargs="+", help="solvers/<id>/<version>")
    parser.add_argument(
        "--list-offered",
        action="store_true",
        help="print the given directories that are still on offer, one per "
        "line, and check nothing. Used by the workflows to skip retired or "
        "deleted submissions before validating or installing them",
    )
    args = parser.parse_args()

    if args.list_offered:
        for solver_dir in args.solver_dirs:
            if is_offered(solver_dir):
                print(solver_dir)
        return 0

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
