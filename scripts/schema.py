#!/usr/bin/env python3
"""
schema.py — the handful of constants docs/SCHEMA.md defines as a contract,
in one place so the other scripts cannot disagree about them.

Nothing here parses or produces records; it is only the things they all have
to spell identically.
"""

# The version this project is developed and run against, everywhere: the
# workflows, the WSL machine that collects, and the API host. register.py
# builds each solver's venv by cloning the interpreter running it, so the
# version here is the version solvers get installed under.
PYTHON_VERSION = "3.12"

# Below this, a solver pinning a recent dependency cannot be installed at all:
# vibecheck requires onnxruntime 1.26, which publishes nothing for 3.10.
MINIMUM_PYTHON = (3, 11)

# Bumped on any change that could break a reader. MAJOR.MINOR: a reader may
# refuse a file whose MAJOR it does not understand, rather than half-read it.
SCHEMA_VERSION = "1.0"

# The one timestamp format the database uses, everywhere.
ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def now_iso():
    """ISO 8601 UTC, seconds precision, 'Z' suffix."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime(ISO_FORMAT)


def major(schema_version):
    """
    '1.0' -> '1'. Used to decide whether a file on disk is readable: a MINOR
    bump adds fields a reader can ignore, a MAJOR bump may not.
    """
    return str(schema_version).split(".", 1)[0]
