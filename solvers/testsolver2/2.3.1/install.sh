#!/usr/bin/env bash
#
# TestSolver Two 2.3.1, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver2 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver2" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Two" ; exit 0 ;;
  --version) echo "2.3.1" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver2 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "7"
    echo "21"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float16"
    echo "float32"
    echo "float64"
    echo "bfloat16"
    ;;
  --onnx-operators)
    echo "Conv"
    echo "Relu"
    echo "MaxPool"
    echo "AveragePool"
    echo "Gemm"
    echo "MatMul"
    echo "Add"
    echo "Sub"
    echo "Mul"
    echo "Sigmoid"
    echo "Tanh"
    echo "Softmax"
    echo "BatchNormalization"
    echo "Reshape"
    echo "Flatten"
    echo "Concat"
    echo "Transpose"
    ;;
  --vnnlib-versions)
    echo "1.0"
    echo "2.0"
    ;;
  --hidden-node-theories)
    echo "NH"
    echo "H"
    ;;
  --multiple-input-output-theories)
    echo "SIO"
    echo "MIO"
    ;;
  --multiple-network-theories)
    echo "SNET"
    echo "MENET"
    echo "MINET"
    echo "MNET"
    ;;
  --multiple-node-comparison-theories)
    echo "SNC"
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

chmod +x "$SOLVER_BIN_DIR/testsolver2"
echo "installed testsolver2 2.3.1 into $SOLVER_BIN_DIR"
