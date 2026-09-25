#!/usr/bin/env bash
#
# TestSolver Fourteen 1.0.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver14 into $SOLVER_BIN_DIR and exits 0.
#
# This solver is the one whose capabilities do not only grow: float64 is here
# in 1.0.0, absent in 1.5.0, and back in 2.0.0. A float64 search therefore
# matches its first and last releases but not the middle one, which is the
# case that makes /search return two version ranges rather than one span.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver14" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Fourteen" ; exit 0 ;;
  --version) echo "1.0.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver14 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "7"
    echo "12"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float64"
    ;;
  --onnx-operators)
    echo "Gemm"
    ;;
  --vnnlib-versions)
    echo "1.0"
    echo "1.0"
    ;;
  --hidden-node-theories)
    echo "NH"
    ;;
  --multiple-input-output-theories)
    echo "SIO"
    ;;
  --multiple-network-theories)
    echo "SNET"
    ;;
  --multiple-node-comparison-theories)
    echo "SNC"
    ;;
  --arithmetic-complexity-theories)
    echo "BND"
    ;;
  --optimised-disjunctive-reasoning) echo "false" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver14"
echo "installed testsolver14 1.0.0 into $SOLVER_BIN_DIR"
