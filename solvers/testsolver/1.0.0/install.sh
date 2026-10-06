#!/usr/bin/env bash
#
# A fake solver that installs in a fraction of a second and answers all 13
# commands correctly. Use it to exercise collect.py and register.py without
# waiting on vibecheck, which pulls torch and takes real minutes per run.
#
# It honours the same contract SUBMITTING.md gives real submitters: it writes
# an executable named exactly <id> into $SOLVER_BIN_DIR and exits 0.
#
# To drive collect.py by hand, with no register.py and no venv:
#
#   mkdir -p /tmp/solverbin
#   SOLVER_BIN_DIR=/tmp/solverbin tests/fixtures/testsolver/1.0.0/install.sh
#   PATH=/tmp/solverbin:$PATH python3 -c "
#   import json, sys; sys.path.insert(0, 'scripts'); import collect
#   print(json.dumps(collect.collect('testsolver', 'testsolver', '1.0.0'), indent=2))"
#
set -euo pipefail

# On the real runner this is always set. Defaulting to the working directory
# keeps the script usable straight from a shell.
: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

# Answers mirror the vibecheck record in data/solvers.sample.json, including
# its ' * note' suffixes, so a successful collect can be diffed against a
# known-good record.
cat > "$SOLVER_BIN_DIR/testsolver" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver" ; exit 0 ;;
  --version) echo "1.0.0"      ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    # Exactly two lines, min then max.
    echo 8
    echo 20
    ;;
  --onnx-element-types)
    # 'real' first because the analysis is not IEEE-754-faithful; the two
    # concrete types carry that caveat as a note.
    echo "real"
    echo "float32 * bounds computed in real arithmetic, not IEEE-754-faithful"
    echo "float64 * bounds computed in real arithmetic, not IEEE-754-faithful"
    ;;
  --onnx-operators)
    # Format not pinned down by the standard text we have. An operator with
    # no types listed means every type in --onnx-element-types, not none.
    echo "Conv float64 float32"
    echo "Relu"
    echo "MaxPool"
    echo "Gemm"
    ;;
  --vnnlib-versions)
    # Two lines again, but version strings, not integers.
    echo "1.0"
    echo "2.0"
    ;;
  --hidden-node-theories)              echo "NH" ;;
  --multiple-input-output-theories)
    echo "SIO * multi-input models run only through the attack-only quantized-surrogate handler (sat/timeout, never unsat)"
    ;;
  --multiple-network-theories)
    echo "SNET"
    echo "MENET"
    echo "MINET * two-network pairs only"
    ;;
  --multiple-node-comparison-theories) echo "SNC" ;;
  --arithmetic-complexity-theories)
    # Reports the full set rather than just the strongest — both readings are
    # permitted, and satisfies normalises them.
    echo "BND"
    echo "OUTC"
    echo "LIN"
    echo "POLY * polynomial constraints transpiled via nonlinear-augment"
    ;;
  --optimised-disjunctive-reasoning)   echo "true" ;;
  --serialise-assignments)             echo "true" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver"
echo "installed testsolver into $SOLVER_BIN_DIR"
