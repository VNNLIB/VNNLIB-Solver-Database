#!/usr/bin/env bash
#
# The third way to fail SUBMITTING.md's contract: the script does everything
# right except leave an executable named <id> on PATH. Exits 0, installs
# nothing under that name.
# Expected outcome: status "install_failed", named as a missing executable
# rather than a broken script — the submitter needs to know which it was.
#
set -euo pipefail

# Version named for validate.py, as a from-source submission would.
readonly VERSION=1.0.0

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

# Note the name: not "ghostsolver", so find_executable comes back empty.
cat > "$SOLVER_BIN_DIR/ghost-solver-typo" <<'SOLVER'
#!/usr/bin/env bash
echo "GhostSolver"
SOLVER
chmod +x "$SOLVER_BIN_DIR/ghost-solver-typo"

echo "installed (under the wrong name)"
