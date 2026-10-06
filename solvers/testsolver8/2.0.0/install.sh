#!/usr/bin/env bash
#
# TestSolver Eight 2.0.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver8 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver8" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Eight" ; exit 0 ;;
  --version) echo "2.0.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver8 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "12"
    echo "19"
    ;;
  --onnx-element-types)
    echo "float32"
    echo "float64"
    ;;
  --onnx-operators)
    echo "Conv float32 float64"
    echo "Gemm float32 float64"
    echo "Relu float32"
    echo "Sigmoid float64"
    echo "MaxPool float32"
    ;;
  --vnnlib-versions)
    echo "2.0"
    echo "2.0"
    ;;
  --hidden-node-theories)
    echo "H"
    ;;
  --multiple-input-output-theories)
    echo "SIO"
    ;;
  --multiple-network-theories)
    echo "SNET"
    ;;
  --multiple-node-comparison-theories)
    echo "MNC"
    ;;
  --arithmetic-complexity-theories)
    echo "BND"
    echo "OUTC"
    echo "LIN"
    ;;
  --optimised-disjunctive-reasoning) echo "true" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver8"
echo "installed testsolver8 2.0.0 into $SOLVER_BIN_DIR"
