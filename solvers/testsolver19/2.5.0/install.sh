#!/usr/bin/env bash
#
# TestSolver Nineteen 2.5.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver19 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver19" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Nineteen" ; exit 0 ;;
  --version) echo "2.5.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver19 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "12"
    echo "20"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float32"
    ;;
  --onnx-operators)
    echo "Conv float32"
    echo "Relu"
    echo "MaxPool"
    echo "Softmax"
    echo "Sigmoid"
    echo "Tanh"
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
    echo "MIO"
    ;;
  --multiple-network-theories)
    echo "SNET"
    echo "MENET * second network must be frozen"
    ;;
  --multiple-node-comparison-theories)
    echo "SNC"
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

chmod +x "$SOLVER_BIN_DIR/testsolver19"
echo "installed testsolver19 2.5.0 into $SOLVER_BIN_DIR"
