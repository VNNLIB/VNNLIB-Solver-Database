#!/usr/bin/env python3
"""register.py: install one solver in a throwaway environment and collect it."""

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

DEFAULT_TIMEOUT_SECONDS = 30 * 60

OUTPUT_TAIL_LINES = 20


@dataclass
class InstallOutcome:
    """The three distinguishable results of running install.sh."""

    status: str
    returncode: int
    output: str

    @property
    def ok(self):
        """Whether the solver answered everything asked of it."""
        return self.status == "ok"

    def error_message(self):
        """The errors[] entry, phrased as SCHEMA.md's deadsolver record is."""
        if self.status == "timeout":
            return f"install script exceeded the time limit: {self.output}"
        if self.status == "unrunnable":
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
    env_dir = Path(work_dir) / "venv"
    venv.EnvBuilder(with_pip=True, clear=True).create(env_dir)
    bin_dir = env_dir / ("Scripts" if os.name == "nt" else "bin")
    return bin_dir


def _install_env(bin_dir):
    """The environment install.sh runs under."""
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["SOLVER_BIN_DIR"] = str(bin_dir)
    env["VIRTUAL_ENV"] = str(Path(bin_dir).parent)
    env.pop("PYTHONHOME", None)
    return env


def run_install_script(script_path, bin_dir, timeout_seconds):
    """Run install.sh with bin_dir on PATH and a timeout."""
    script_path = Path(script_path).resolve()
    try:
        completed = subprocess.run(
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
    }


def _reported_name(binary, fallback):
    """What `<solver> --name` says."""
    returncode, stdout, _ = collect.run_query(binary, "--name")
    if returncode != 0 or not stdout.strip():
        return fallback
    return stdout.strip().splitlines()[0].strip()


def _declared(solver_dir):
    """(name, url) from solver.toml."""
    data = validate.read_solver_toml(solver_dir / "solver.toml") or {}
    return str(data.get("name") or ""), str(data.get("url") or "")


def register(solver_dir, timeout_seconds=DEFAULT_TIMEOUT_SECONDS):
    """Install, collect, tear down."""
    solver_dir = Path(solver_dir)
    solver_id = solver_dir.parent.name
    version = solver_dir.name

    declared_name, url = _declared(solver_dir)
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
        shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "id": solver_id,
        "name": name,
        "url": url,
        "versions": [record],
    }


def check_interpreter():
    """Refuse to collect under an interpreter too old to install solvers with."""
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
    """Install one submission, collect it, and print the record."""
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

    print(json.dumps(solver, separators=(",", ":")))

    print(
        f"{solver['id']} {version_record['version']}: {version_record['status']}",
        file=sys.stderr,
    )
    for error in version_record.get("errors", []):
        print(f"  {error}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
