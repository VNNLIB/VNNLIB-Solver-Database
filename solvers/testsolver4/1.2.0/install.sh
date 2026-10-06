#!/usr/bin/env bash
#
# TestSolver Four 1.2.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver4 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver4" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Four" ; exit 0 ;;
  --version) echo "1.2.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver4 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "13"
    echo "13"
    ;;
  --onnx-element-types)
    echo "real"
    echo "float64"
    ;;
  --onnx-operators)
    echo "Gemm float64"
    echo "Relu"
    ;;
  --vnnlib-versions)
    echo "2.0"
    echo "2.0"
    ;;
  --hidden-node-theories)
    echo "NH"
    ;;
  --multiple-input-output-theories)
    echo "MIO"
    ;;
  --multiple-network-theories)
    echo "MENET"
    ;;
  --multiple-node-comparison-theories)
    echo "SNC"
    ;;
  --arithmetic-complexity-theories)
    echo "BND"
    echo "OUTC"
    ;;
  --optimised-disjunctive-reasoning) echo "false" ;;
  --serialise-assignments)           echo "true" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver4"
echo "installed testsolver4 1.2.0 into $SOLVER_BIN_DIR"
