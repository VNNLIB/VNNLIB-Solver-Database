#!/usr/bin/env bash
#
# TestSolver Three 0.9.0, a fake solver for exercising the pipeline.
#
# It installs in a fraction of a second and answers all 13 commands of the
# VNN-LIB 2.0 CLI correctly, so it collects as "ok". It honours the same
# contract SUBMITTING.md gives real submitters: it writes an executable named
# exactly testsolver3 into $SOLVER_BIN_DIR and exits 0.
#
set -euo pipefail

: "${SOLVER_BIN_DIR:=$PWD}"
mkdir -p "$SOLVER_BIN_DIR"

cat > "$SOLVER_BIN_DIR/testsolver3" <<'SOLVER'
#!/usr/bin/env bash
set -uo pipefail

case "${1:-}" in
  --name)    echo "TestSolver Three" ; exit 0 ;;
  --version) echo "0.9.0" ; exit 0 ;;
  supports)  ;;
  *) echo "usage: testsolver3 [--name|--version|supports <flag>]" >&2; exit 2 ;;
esac

case "${2:-}" in
  --onnx-opset-versions)
    echo "11"
    echo "18"
    ;;
  --onnx-element-types)
    echo "float32"
    ;;
  --onnx-operators)
    echo "Conv float32"
    echo "Relu float32"
    echo "Gemm float32"
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
    echo "MNET"
    ;;
  --multiple-node-comparison-theories)
    echo "MNC"
    ;;
  --arithmetic-complexity-theories)
    echo "POLY"
    ;;
  --optimised-disjunctive-reasoning) echo "true" ;;
  --serialise-assignments)           echo "false" ;;
  *) echo "unknown supports flag: ${2:-<none>}" >&2; exit 2 ;;
esac
SOLVER

chmod +x "$SOLVER_BIN_DIR/testsolver3"
echo "installed testsolver3 0.9.0 into $SOLVER_BIN_DIR"
