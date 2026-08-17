#!/usr/bin/env python3
"""
schema.py — the handful of constants docs/SCHEMA.md defines as a contract,
in one place so collect.py, register.py and build.py cannot disagree about
them.

Nothing here parses or produces records; it is only the things all three
have to spell identically.
"""

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
