#!/usr/bin/env bash
#
# The other half of the fixture pair: a fake solver that installs fine and
# then misbehaves in each of the four ways collect.py has to survive, so the
# "incomplete" path gets exercised as often as the happy one.
#
#   --multiple-node-comparison-theories   prints nothing
#   --arithmetic-complexity-theories      prints LINEAR, which is not permitted
#   --onnx-opset-versions                 exits non-zero
#   --vnnlib-versions                     prints one line where two are required
#   --version                             disagrees with the directory name
#
# Expected outcome: status "incomplete", those five fields null or flagged,
# and the other six capabilities collected normally. Mirrors the brokennn
# record in data/solvers.sample.json.
#
#   mkdir -p /tmp/solverbin
#   SOLVER_BIN_DIR=/tmp/solverbin tests/fixtures/brokensolver/0.9.0/install.sh
#   PATH=/tmp/solverbin:$PATH python3 -c "
#   import json, sys; sys.path.insert(0, 'scripts'); import collect
#   print(json.dumps(collect.collect('brokensolver', 'brokensolver', '0.9.0'), indent=2))"
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/brokensolver" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "BrokenSolver" ; exit 0 ;;
  # Disagrees with the submission directory (0.9.0). The directory name wins;
  # the mismatch is recorded as an error.
  --version) echo "0.9.0-dev"    ; exit 0 ;;
  supports)  ;;
  *) echo "usage: brokensolver [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "error: opset table not built" >&2
    exit 1
    ;;
  --onnx-element-types)
    echo "float32"
    ;;
  --onnx-operators)
    echo "Relu"
    echo "Gemm"
    ;;
  --vnnlib-versions)
    # One line where the standard requires two.
    echo "2.0"
    ;;
  --hidden-node-theories)              echo "NH" ;;
  --multiple-input-output-theories)    echo "SIO" ;;
  --multiple-network-theories)         echo "SNET" ;;
  --multiple-node-comparison-theories)
    # Exits 0 having printed nothing at all.
    :
    ;;
  --arithmetic-complexity-theories)
    # Not a permitted identifier: a conformance failure, not an unknown value.
    echo "LINEAR"
    ;;
  --optimised-disjunctive-reasoning)   echo "false" ;;
  --serialise-assignments)             echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/brokensolver"
echo "installed brokensolver into $SOLVER_BIN_DIR"
