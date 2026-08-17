#!/usr/bin/env bash
set -euo pipefail

# Real solver. Pulls torch, so this is the heavy path — the earlier sandbox
# here couldn't reach download.pytorch.org, but a GitHub-hosted runner has
# normal internet access, so this is the first time it actually gets tested
# end to end ratherdd than just read from source.
# Not --quiet: when this fails, its output is the only diagnosis the submitter
# gets, and register.py keeps only the tail of it.
pip install vibecheck-nn==1.1.0
