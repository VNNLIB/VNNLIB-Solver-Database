#!/usr/bin/env python3
"""Copy the canonical database into the vnnfilter package before a release."""

from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "data" / "solvers.json"
DEST = REPO_ROOT / "src" / "vnnfilter" / "_data" / "solvers.json"


def main(argv: list[str] | None = None) -> int:
    """Copy the database into the package, or check that the copy is current."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the bundled copy is out of date, without writing anything",
    )
    args = parser.parse_args(argv)

    if not SOURCE.is_file():
        print(f"sync_package_data: {SOURCE} does not exist", file=sys.stderr)
        return 1

    up_to_date = DEST.is_file() and filecmp.cmp(SOURCE, DEST, shallow=False)

    if args.check:
        if not up_to_date:
            print(
                f"sync_package_data: {DEST} is stale; run `python scripts/sync_package_data.py`",
                file=sys.stderr,
            )
            return 1
        print("sync_package_data: bundled data is up to date")
        return 0

    if up_to_date:
        print("sync_package_data: bundled data already up to date")
        return 0

    DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, DEST)
    print(f"sync_package_data: copied {SOURCE} -> {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
