#!/usr/bin/env bash
#
# TestSolver Twenty 0.9.9, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver20 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver20" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Twenty" ; exit 0 ;;
  --version) echo "0.9.9" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver20 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "7"
    echo "10"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float32"
    ;;
  --onnx-operators)
    echo "Conv"
    echo "Relu"
    echo "MaxPool"
    echo "AveragePool"
    echo "Gemm"
    echo "MatMul"
    echo "Add"
    echo "Mul"
    echo "Concat"
    echo "Reshape"
    echo "Flatten"
    echo "Transpose"
    echo "Sigmoid"
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
    ;;
  --optimised-disjunctive-reasoning) echo "false" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver20"
echo "installed testsolver20 0.9.9 into $SOLVER_BIN_DIR"
