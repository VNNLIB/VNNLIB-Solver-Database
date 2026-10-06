#!/usr/bin/env bash
#
# TestSolver Thirteen 2.2.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver13 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver13" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Thirteen" ; exit 0 ;;
  --version) echo "2.2.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver13 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "13"
    echo "21"
    ;;
  --onnx-element-types)
    echo "float32"
    echo "float64"
    echo "bfloat16 * bfloat16 inputs are widened to float32 before analysis"
    ;;
  --onnx-operators)
    echo "Conv"
    echo "Relu"
    echo "MaxPool"
    echo "Gemm"
    echo "BatchNormalization"
    ;;
  --vnnlib-versions)
    echo "2.0"
    echo "2.0"
    ;;
  --hidden-node-theories)
    echo "H"
    ;;
  --multiple-input-output-theories)
    echo "MIO"
    ;;
  --multiple-network-theories)
    echo "MENET"
    echo "MINET"
    ;;
  --multiple-node-comparison-theories)
    echo "MNC"
    ;;
  --arithmetic-complexity-theories)
    echo "BND"
    echo "OUTC"
    echo "LIN"
    echo "POLY"
    ;;
  --optimised-disjunctive-reasoning) echo "true" ;;
  --serialise-assignments)           echo "true" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver13"
echo "installed testsolver13 2.2.0 into $SOLVER_BIN_DIR"
