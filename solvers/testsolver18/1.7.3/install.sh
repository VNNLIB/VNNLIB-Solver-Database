#!/usr/bin/env bash
#
# TestSolver Eighteen 1.7.3, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver18 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver18" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Eighteen" ; exit 0 ;;
  --version) echo "1.7.3" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver18 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "9"
    echo "15"
    ;;
  --onnx-element-types)
    echo "float64"
    ;;
  --onnx-operators)
    echo "Gemm float64"
    echo "Relu float64"
    echo "Sub float64"
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
    echo "OUTC"
    echo "LIN"
    ;;
  --optimised-disjunctive-reasoning) echo "false" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver18"
echo "installed testsolver18 1.7.3 into $SOLVER_BIN_DIR"
