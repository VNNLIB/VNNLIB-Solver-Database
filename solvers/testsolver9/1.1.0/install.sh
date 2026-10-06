#!/usr/bin/env bash
#
# TestSolver Nine 1.1.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver9 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver9" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Nine" ; exit 0 ;;
  --version) echo "1.1.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver9 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "8"
    echo "15"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float32 * rounded outward at every layer boundary"
    echo "float64 * rounded outward at every layer boundary"
    ;;
  --onnx-operators)
    echo "Conv float32"
    echo "Relu"
    echo "Softmax"
    ;;
  --vnnlib-versions)
    echo "1.0"
    echo "2.0"
    ;;
  --hidden-node-theories)
    echo "H * hidden declarations are inlined before solving"
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
    echo "POLY * degree 2 only"
    ;;
  --optimised-disjunctive-reasoning) echo "false" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver9"
echo "installed testsolver9 1.1.0 into $SOLVER_BIN_DIR"
