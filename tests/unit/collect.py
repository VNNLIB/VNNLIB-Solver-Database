#!/usr/bin/env python3
"""
Unit tests for scripts/collect.py.

No install, no venv, no network: run_query is the only thing in collect.py
that touches the outside world, and the one test that needs it swaps it for a
lookup table. Everything else is a pure function over a string, so hand-typed
solver output is enough.

    python3 tests/unit/collect.py

pytest does not pick this file up by default (its default pattern is
test_*.py). To run it under pytest, point it at the file explicitly:

    pytest tests/unit/collect.py -p no:cacheprovider
"""

import importlib.util
import pathlib
import sys

# Loaded by path, not by `import collect`: this file is also named collect.py,
# so a plain import would resolve to itself depending on cwd.
_SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / "scripts"
# collect.py imports its sibling schema.py, which loading by path does not
# put on sys.path for it.
sys.path.insert(0, str(_SCRIPTS))

_SOURCE = _SCRIPTS / "collect.py"
_spec = importlib.util.spec_from_file_location("solver_collect", _SOURCE)
solver_collect = importlib.util.module_from_spec(_spec)
sys.modules["solver_collect"] = solver_collect
_spec.loader.exec_module(solver_collect)

collect_record = solver_collect.collect
expand_closure = solver_collect.expand_closure
parse_boolean = solver_collect.parse_boolean
parse_element_types = solver_collect.parse_element_types
parse_operators = solver_collect.parse_operators
parse_opset = solver_collect.parse_opset
parse_theory_output = solver_collect.parse_theory_output
parse_vnnlib_versions = solver_collect.parse_vnnlib_versions
split_note = solver_collect.split_note


def test_split_note():
    assert split_note("POLY") == ("POLY", None)
    assert split_note("POLY * a note") == ("POLY", "* a note")
    # Delimiter is not assumed to be '*', only that something separates.
    assert split_note("POLY -- other") == ("POLY", "-- other")


def test_theory_output():
    raw = "BND\nOUTC\nLIN\nPOLY * polynomial constraints transpiled via nonlinear-augment\n"
    identifiers, notes, errors = parse_theory_output(raw, "arithmetic")
    assert identifiers == ["BND", "OUTC", "LIN", "POLY"]
    assert errors == []
    assert notes == [
        {
            "field": "arithmetic",
            "identifier": "POLY",
            "text": "* polynomial constraints transpiled via nonlinear-augment",
        }
    ]


def test_theory_output_normalises_order():
    # Reported out of order, blank lines, duplicates -> PERMITTED order, no dupes.
    identifiers, _, errors = parse_theory_output("POLY\n\nBND\nPOLY\n", "arithmetic")
    assert identifiers == ["BND", "POLY"]
    assert errors == []


def test_theory_output_rejects_unpermitted():
    # SCHEMA.md's brokennn case, message included.
    identifiers, _, errors = parse_theory_output("LINEAR\n", "arithmetic")
    assert identifiers == []
    assert errors == [
        "returned ['LINEAR'], expected a subset of ['BND', 'LIN', 'OUTC', 'POLY']"
    ]


def test_theory_output_empty_is_not_an_error_here():
    # Empty output is not this function's error to raise — collect() records it.
    assert parse_theory_output("", "arithmetic") == ([], [], [])


def test_min_max():
    assert parse_opset("8\n20\n") == [8, 20]
    assert parse_opset(" 15 \n\n 18 \n") == [15, 18]
    assert parse_opset("8\n") is None
    assert parse_opset("8\n20\n21\n") is None
    assert parse_opset("eight\ntwenty") is None
    assert parse_vnnlib_versions("1.0\n2.0\n") == ["1.0", "2.0"]
    # Not coerced to numbers: '2.0' stays a string.
    assert parse_vnnlib_versions("2.0\n2.0") == ["2.0", "2.0"]
    assert parse_vnnlib_versions("2.0") is None


def test_element_types():
    raw = (
        "real\n"
        "float32 * bounds computed in real arithmetic, not IEEE-754-faithful\n"
        "float64 * bounds computed in real arithmetic, not IEEE-754-faithful\n"
    )
    types, notes = parse_element_types(raw)
    assert types == ["real", "float32", "float64"]
    assert [n["identifier"] for n in notes] == ["float32", "float64"]
    assert all(n["field"] == "element_types" for n in notes)
    assert parse_element_types("") == ([], [])


def test_operators():
    assert parse_operators("Conv float64 float32\nRelu float64 float32\n") == {
        "Conv": ["float64", "float32"],
        "Relu": ["float64", "float32"],
    }
    # A bare name is stored as an empty list, exactly as printed. It MEANS
    # every type in element_types, but expanding it here would put derived
    # data in capabilities — consumers do that reading.
    assert parse_operators("Conv float64\nRelu\nGemm\n") == {
        "Conv": ["float64"],
        "Relu": [],
        "Gemm": [],
    }
    assert parse_operators("") == {}
    assert parse_operators("  Relu  \n\n") == {"Relu": []}


def test_boolean():
    assert parse_boolean(" true \n") is True
    assert parse_boolean("false\n") is False
    # Not conforming, and not guessed at: the caller turns None into an error
    # and leaves the field null.
    assert parse_boolean("yes") is None
    assert parse_boolean("True") is None
    assert parse_boolean("") is None


def test_closure():
    assert expand_closure("arithmetic", ["POLY"]) == ["BND", "OUTC", "LIN", "POLY"]
    # PERMITTED order, not input order, not alphabetical.
    assert expand_closure("arithmetic", ["LIN", "BND"]) == ["BND", "OUTC", "LIN"]
    # SNET and MENET are disjoint: MINET does not imply SNET.
    assert expand_closure("multiple_networks", ["MINET"]) == ["MENET", "MINET"]
    assert expand_closure("multiple_networks", ["SNET", "MINET"]) == [
        "SNET",
        "MENET",
        "MINET",
    ]
    assert expand_closure("multiple_networks", ["MNET"]) == [
        "SNET",
        "MENET",
        "MINET",
        "MNET",
    ]
    assert expand_closure("hidden_nodes", []) == []


def _conforming_responses():
    """What a fully conforming solver prints, keyed by the args it was given."""
    return {
        ("--name",): (0, "vibecheck\n", ""),
        ("--version",): (0, "1.1.0\n", ""),
        ("supports", "--onnx-opset-versions"): (0, "8\n20\n", ""),
        ("supports", "--onnx-element-types"): (0, "real\nfloat32 * caveat\nfloat64\n", ""),
        ("supports", "--onnx-operators"): (0, "Conv\nRelu\n", ""),
        ("supports", "--vnnlib-versions"): (0, "1.0\n2.0\n", ""),
        ("supports", "--hidden-node-theories"): (0, "NH\n", ""),
        ("supports", "--multiple-input-output-theories"): (0, "SIO\n", ""),
        ("supports", "--multiple-network-theories"): (0, "SNET\nMENET\nMINET\n", ""),
        ("supports", "--multiple-node-comparison-theories"): (0, "SNC\n", ""),
        ("supports", "--arithmetic-complexity-theories"): (
            0,
            "BND\nOUTC\nLIN\nPOLY * t\n",
            "",
        ),
        ("supports", "--optimised-disjunctive-reasoning"): (0, "true\n", ""),
        ("supports", "--serialise-assignments"): (0, "false\n", ""),
    }


class _FakeSolver:
    """Stands in for run_query, so collect() runs with no binary present."""

    def __init__(self, responses):
        self.responses = responses
        self.real = solver_collect.run_query

    def __enter__(self):
        solver_collect.run_query = lambda binary, *args: self.responses[args]
        return self.responses

    def __exit__(self, *exc):
        solver_collect.run_query = self.real
        return False


def test_collect_conforming_solver():
    with _FakeSolver(_conforming_responses()):
        record = collect_record("vibecheck", "vibecheck", "1.1.0")

    assert record["status"] == "ok"
    assert "errors" not in record
    # Capability order follows SUPPORTS_FLAGS, so records diff cleanly.
    assert list(record["capabilities"]) == [
        "onnx_opset",
        "element_types",
        "operators",
        "vnnlib_versions",
        "hidden_nodes",
        "multiple_io",
        "multiple_networks",
        "node_comparisons",
        "arithmetic",
        "optimised_disjunction",
        "serialise_assignments",
    ]
    assert record["capabilities"]["onnx_opset"] == [8, 20]
    assert record["capabilities"]["optimised_disjunction"] is True
    assert record["capabilities"]["serialise_assignments"] is False
    assert record["satisfies"]["multiple_networks"] == ["SNET", "MENET", "MINET"]
    assert [n["identifier"] for n in record["notes"]] == ["float32", "POLY"]
    assert record["collected_at"].endswith("Z")


def test_collect_survives_broken_flags():
    """Three flags broken the way brokennn is broken; the other ten survive."""
    responses = _conforming_responses()
    responses[("supports", "--multiple-node-comparison-theories")] = (0, "\n", "")
    responses[("supports", "--arithmetic-complexity-theories")] = (0, "LINEAR\n", "")
    responses[("supports", "--onnx-opset-versions")] = (1, "", "boom\n")

    with _FakeSolver(responses):
        record = collect_record("vibecheck", "vibecheck", "1.1.0")

    assert record["status"] == "incomplete"
    assert record["capabilities"]["node_comparisons"] is None
    assert record["capabilities"]["arithmetic"] is None
    assert record["capabilities"]["onnx_opset"] is None
    assert record["satisfies"]["node_comparisons"] == []
    assert record["satisfies"]["arithmetic"] == []
    # Untouched flags still collected.
    assert record["capabilities"]["multiple_networks"] == ["SNET", "MENET", "MINET"]
    assert record["errors"] == [
        "--onnx-opset-versions: exited 1: boom",
        "--multiple-node-comparison-theories: produced no output",
        "--arithmetic-complexity-theories: returned ['LINEAR'], "
        "expected a subset of ['BND', 'LIN', 'OUTC', 'POLY']",
    ]


def test_collect_version_cross_check():
    """A disagreeing --version is an error, and the directory name still wins."""
    responses = _conforming_responses()
    responses[("--version",)] = (0, "1.1.1\n", "")

    with _FakeSolver(responses):
        record = collect_record("vibecheck", "vibecheck", "1.1.0")

    assert record["version"] == "1.1.0"
    assert record["status"] == "incomplete"
    assert any("--version: reported '1.1.1'" in e for e in record["errors"])


def test_run_query_reports_missing_binary_without_raising():
    returncode, stdout, stderr = solver_collect.run_query("/nonexistent/solver", "--name")
    assert returncode != 0
    assert stdout == ""
    assert "could not execute" in stderr


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} passed")


if __name__ == "__main__":
    main()
