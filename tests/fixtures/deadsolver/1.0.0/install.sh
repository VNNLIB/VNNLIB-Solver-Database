#!/usr/bin/env bash
#
# Fails the way SCHEMA.md's deadsolver record fails: the script exits
# non-zero, so there is nothing to query and collect is never called.
# Expected outcome: status "install_failed", no capabilities key.
#
set -euo pipefail

# Names its version to satisfy validate.py, the way a from-source submission
# would: the check is on the script text, not on how the install happens.
echo "installing deadsolver 1.0.0"
echo "resolving dependencies..."
echo "E: Unable to locate package libgmp-dev" >&2
exit 1
