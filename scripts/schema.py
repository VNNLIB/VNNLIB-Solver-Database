#!/usr/bin/env python3
"""schema.py: the constants SCHEMA.md defines as a contract, in one place."""

PYTHON_VERSION = "3.12"

MINIMUM_PYTHON = (3, 11)

SCHEMA_VERSION = "2.0"

ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def now_iso():
    """ISO 8601 UTC, seconds precision, 'Z' suffix."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime(ISO_FORMAT)


def major(schema_version):
    """'1.0' -> '1'."""
    return str(schema_version).split(".", 1)[0]
