#!/usr/bin/env python3
"""
register.py — install one submitted solver in an isolated environment, hand it
to collect.py, and tear the environment down again.

This module owns everything about HOW a solver gets onto the machine.
collect.py owns everything about WHAT to ask it once it's there.

Testing: see tests/README.md.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import venv
from dataclasses import dataclass
from pathlib import Path

import collect
import schema
import validate

# SUBMITTING.md's limit: "it runs longer than 30 minutes" is a failure.
DEFAULT_TIMEOUT_SECONDS = 30 * 60

# Tail of a failing script's output kept in the error, because the reason is
# at the end. 20 not 5: pip's ResolutionImpossible puts its ERROR lines last
# and the explanation above them, so a short tail keeps only the useless part.
OUTPUT_TAIL_LINES = 20


@dataclass
class InstallOutcome:
    """The three distinguishable results of running install.sh."""

    status: str  # "ok" | "failed" | "timeout" | "unrunnable"
    returncode: int
    output: str  # tail of stdout+stderr, already joined

    @property
    def ok(self):
        return self.status == "ok"

    def error_message(self):
        """The errors[] entry, phrased as SCHEMA.md's deadsolver record is."""
        if self.status == "timeout":
            return f"install script exceeded the time limit: {self.output}"
        if self.status == "unrunnable":
            # Kept distinct from a non-zero exit: this is a missing shebang,
            # a missing executable bit or CRLF line endings, and SUBMITTING.md
            # warns about each by name.
            return f"install script could not be executed: {self.output}"
        return f"install script exited {self.returncode}: {self.output}"


def _tail(*streams):
    """Last few non-blank lines of the given output, joined for one-line JSON."""
    lines = []
    for stream in streams:
        if not stream:
            continue
        if isinstance(stream, bytes):
            stream = stream.decode("utf-8", errors="replace")
        lines.extend(l.strip() for l in stream.splitlines() if l.strip())
    return " | ".join(lines[-OUTPUT_TAIL_LINES:])


def make_isolated_env(work_dir):
    """Fresh venv in work_dir; returns its bin/ dir, i.e. $SOLVER_BIN_DIR."""
    # clear=True keeps SUBMITTING.md's promise of "an empty virtual
    # environment", not one carrying leftovers from the previous solver.
    env_dir = Path(work_dir) / "venv"
    # with_pip because a plain `pip install` is the documented happy path.
    venv.EnvBuilder(with_pip=True, clear=True).create(env_dir)
    bin_dir = env_dir / ("Scripts" if os.name == "nt" else "bin")
    return bin_dir


def _install_env(bin_dir):
    """The environment install.sh runs under."""
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["SOLVER_BIN_DIR"] = str(bin_dir)
    # What `pip` reads to decide it is inside a venv; without it a submitter
    # who invokes pip by absolute path could install into the system Python.
    env["VIRTUAL_ENV"] = str(Path(bin_dir).parent)
    env.pop("PYTHONHOME", None)
    return env


def run_install_script(script_path, bin_dir, timeout_seconds):
    """
    Run install.sh with bin_dir on PATH and a timeout. Returns an
    InstallOutcome; never raises, because a failing script is expected data.
    """
    # Absolute, because cwd below is the solver's own directory: a relative
    # path would be resolved against that, not against where we started.
    script_path = Path(script_path).resolve()
    try:
        completed = subprocess.run(
            # Directly, not via `bash <path>`: the shebang and executable
            # bit are part of SUBMITTING.md's contract, so getting them
            # wrong must fail here, visibly.
            [str(script_path)],
            cwd=str(script_path.parent),
            env=_install_env(bin_dir),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as exc:
        return InstallOutcome(
            status="timeout",
            returncode=124,
            output=_tail(exc.stdout, exc.stderr)
            or f"no output before the {timeout_seconds}s limit",
        )
    except OSError as exc:
        # Missing file, missing executable bit, CRLF line endings.
        return InstallOutcome(status="unrunnable", returncode=126, output=str(exc))

    if completed.returncode != 0:
        return InstallOutcome(
            status="failed",
            returncode=completed.returncode,
            output=_tail(completed.stdout, completed.stderr) or "no output",
        )
    return InstallOutcome(status="ok", returncode=0, output=_tail(completed.stdout))


def find_executable(solver_id, bin_dir):
    """The executable install.sh had to leave behind, or None."""
    # bin_dir first, but all of PATH is searched: `sudo apt install`
    # legitimately lands in /usr/local/bin.
    search_path = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
    found = shutil.which(solver_id, path=search_path)
    return Path(found) if found else None


def _install_failed(version, message):
    """A version record for a solver that never got far enough to be queried."""
    return {
        "version": version,
        "collected_at": schema.now_iso(),
        "status": "install_failed",
        "errors": [message],
        # No capabilities, no satisfies: nothing was measured. SCHEMA.md's
        # rule is to read the absence of capabilities, not the status string.
    }


def _reported_name(binary, fallback):
    """
    What `<solver> --name` says. collect calls it too, but only to check the
    solver answers — the Version table has no name field, so it never returns
    the value. run_query is reused to keep one timeout policy for every
    subprocess here.
    """
    returncode, stdout, _ = collect.run_query(binary, "--name")
    if returncode != 0 or not stdout.strip():
        return fallback
    return stdout.strip().splitlines()[0].strip()


def _declared(solver_dir):
    """
    (name, repo) from solver.toml. Both empty if the file is missing or
    unreadable: validate.py rejects such a submission before it reaches here,
    so this only has to avoid crashing, not to enforce anything.
    """
    data = validate.read_solver_toml(solver_dir / "solver.toml") or {}
    return str(data.get("name") or ""), str(data.get("repo") or "")


def register(solver_dir, timeout_seconds=DEFAULT_TIMEOUT_SECONDS):
    """
    Install, collect, tear down. Returns one SCHEMA.md "Solver" entry.

    The directory name is the authority on id and version. A failed install
    short-circuits: collect is never called, there is nothing to query.
    """
    solver_dir = Path(solver_dir)
    solver_id = solver_dir.parent.name
    version = solver_dir.name

    # SUBMITTING.md: name defaults to what --name reports, so solver.toml wins
    # where it has one. repo has no other source at all — the standard has no
    # --repo — so it is whatever the submission declared.
    declared_name, repo = _declared(solver_dir)
    name = declared_name or solver_id

    work_dir = tempfile.mkdtemp(prefix=f"register-{solver_id}-")
    try:
        bin_dir = make_isolated_env(work_dir)
        outcome = run_install_script(solver_dir / "install.sh", bin_dir, timeout_seconds)

        if not outcome.ok:
            record = _install_failed(version, outcome.error_message())
        else:
            binary = find_executable(solver_id, bin_dir)
            if binary is None:
                record = _install_failed(
                    version,
                    f"install script exited 0 but left no executable "
                    f"named {solver_id!r} on PATH",
                )
            else:
                record = collect.collect(str(binary), solver_id, version)
                if not declared_name:
                    name = _reported_name(str(binary), solver_id)
    finally:
        # The environment must not outlive this call, whatever happened above.
        shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "id": solver_id,
        "name": name,
        "repo": repo,
        "versions": [record],
    }


def check_interpreter():
    """
    Refuse to collect under an interpreter too old to install solvers with.

    make_isolated_env clones the running Python, so `python3 register.py` on
    Ubuntu 22.04 silently builds a 3.10 venv even with 3.12 installed, and the
    failure surfaces minutes later as an unresolvable pip pin. Cheaper to say
    so now.
    """
    if sys.version_info[:2] < schema.MINIMUM_PYTHON:
        running = ".".join(str(v) for v in sys.version_info[:2])
        least = ".".join(str(v) for v in schema.MINIMUM_PYTHON)
        raise SystemExit(
            f"register.py needs Python {least}+ and is running {running}. "
            f"The venv it builds for each solver clones this interpreter, so "
            f"solvers pinning recent dependencies cannot be installed. "
            f"Run it as python{schema.PYTHON_VERSION} instead."
        )


def main():
    check_interpreter()
    parser = argparse.ArgumentParser(
        description="Install one submitted solver, collect its capabilities, "
        "and print the record as one line of JSON."
    )
    parser.add_argument("solver_dir", help="solvers/<id>/<version>")
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"install.sh time limit in seconds (default {DEFAULT_TIMEOUT_SECONDS})",
    )
    args = parser.parse_args()

    solver = register(args.solver_dir, args.timeout)
    version_record = solver["versions"][0]

    # One line, so the workflow's `>> results.jsonl` stays valid JSON Lines.
    print(json.dumps(solver, separators=(",", ":")))

    # Status to stderr, so the Actions log is readable without parsing JSON.
    print(
        f"{solver['id']} {version_record['version']}: {version_record['status']}",
        file=sys.stderr,
    )
    for error in version_record.get("errors", []):
        print(f"  {error}", file=sys.stderr)

    # Always 0: install_failed is a recorded outcome, not a broken run. A
    # non-zero exit here would abort the loop over the remaining solvers.
    return 0


if __name__ == "__main__":
    sys.exit(main())
