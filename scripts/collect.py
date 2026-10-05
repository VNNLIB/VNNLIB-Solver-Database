#!/usr/bin/env python3
"""collect.py: ask a solver binary what it supports, in SCHEMA.md's shapes."""

import subprocess

import schema

SUPPORTS_FLAGS = [
    "--onnx-opset-versions",
    "--onnx-element-types",
    "--onnx-operators",
    "--vnnlib-versions",
    "--hidden-node-theories",
    "--multiple-input-output-theories",
    "--multiple-network-theories",
    "--multiple-node-comparison-theories",
    "--arithmetic-complexity-theories",
    "--optimised-disjunctive-reasoning",
    "--serialise-assignments",
]

THEORY_FLAGS = {
    "--hidden-node-theories": "hidden_nodes",
    "--multiple-input-output-theories": "multiple_io",
    "--multiple-network-theories": "multiple_networks",
    "--multiple-node-comparison-theories": "node_comparisons",
    "--arithmetic-complexity-theories": "arithmetic",
}

OTHER_FLAGS = {
    "--onnx-opset-versions": "onnx_opset",
    "--onnx-element-types": "element_types",
    "--onnx-operators": "operators",
    "--vnnlib-versions": "vnnlib_versions",
    "--optimised-disjunctive-reasoning": "optimised_disjunction",
    "--serialise-assignments": "serialise_assignments",
}

assert set(THEORY_FLAGS) | set(OTHER_FLAGS) == set(SUPPORTS_FLAGS)

PERMITTED_VALUES = {
    "hidden_nodes": ["NH", "H"],
    "multiple_io": ["SIO", "MIO"],
    "multiple_networks": ["SNET", "MENET", "MINET", "MNET"],
    "node_comparisons": ["SNC", "MNC"],
    "arithmetic": ["BND", "OUTC", "LIN", "POLY"],
}

CLOSURE = {
    "hidden_nodes": {"NH": ["NH"], "H": ["NH", "H"]},
    "multiple_io": {"SIO": ["SIO"], "MIO": ["SIO", "MIO"]},
    "multiple_networks": {
        "SNET": ["SNET"],
        "MENET": ["MENET"],
        "MINET": ["MENET", "MINET"],
        "MNET": ["SNET", "MENET", "MINET", "MNET"],
    },
    "node_comparisons": {"SNC": ["SNC"], "MNC": ["SNC", "MNC"]},
    "arithmetic": {
        "BND": ["BND"],
        "OUTC": ["BND", "OUTC"],
        "LIN": ["BND", "OUTC", "LIN"],
        "POLY": ["BND", "OUTC", "LIN", "POLY"],
    },
}

QUERY_TIMEOUT_SECONDS = 60

TIMEOUT_RETURNCODE = 124


def run_query(binary, *args):
    """Run `binary *args` with a short timeout, capturing stdout/stderr."""
    command = [str(binary), *[str(a) for a in args]]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=QUERY_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as exc:
        return (
            TIMEOUT_RETURNCODE,
            _as_text(exc.stdout),
            _as_text(exc.stderr) + f"timed out after {QUERY_TIMEOUT_SECONDS} seconds",
        )
    except OSError as exc:
        return 127, "", f"could not execute: {exc}"
    return completed.returncode, completed.stdout, completed.stderr


def _as_text(stream):
    """Normalise the bytes-or-str-or-None that TimeoutExpired hands back."""
    if stream is None:
        return ""
    if isinstance(stream, bytes):
        return stream.decode("utf-8", errors="replace")
    return stream


def split_note(line):
    """'POLY * some note' -> ('POLY', '* some note') 'POLY'              -> ('POLY', None)."""
    parts = line.split(None, 1)
    if not parts:
        return "", None
    identifier = parts[0]
    note = parts[1].strip() if len(parts) > 1 else None
    return identifier, note


def parse_theory_output(raw_text, field_name):
    """One theory-set flag's stdout as (identifiers, notes, errors)."""
    permitted = PERMITTED_VALUES[field_name]
    seen = set()
    notes = []
    errors = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        identifier, note = split_note(line)
        if identifier not in permitted:
            errors.append(
                f"returned {[identifier]}, expected a subset of {sorted(permitted)}"
            )
            continue
        seen.add(identifier)
        if note is not None:
            notes.append({"field": field_name, "identifier": identifier, "text": note})
    identifiers = [value for value in permitted if value in seen]
    return identifiers, notes, errors


def parse_min_max(raw_text, converter=None):
    """Exactly two non-blank lines, min then max."""
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    if len(lines) != 2:
        return None
    if converter is None:
        return lines
    try:
        return [converter(lines[0]), converter(lines[1])]
    except ValueError:
        return None


def parse_opset(raw_text):
    """--onnx-opset-versions prints two lines, min then max."""
    pair = parse_min_max(raw_text, converter=int)
    if pair is None or pair[0] > pair[1]:
        return None
    return pair


def parse_vnnlib_versions(raw_text):
    """--vnnlib-versions: two lines, kept as version strings rather than numbers."""
    return parse_min_max(raw_text)


def parse_element_types(raw_text):
    """One type name per line (ONNX Set 1 names, plus 'real'), with any ' * note' suffix split off."""
    types = []
    notes = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        identifier, note = split_note(line)
        if identifier not in types:
            types.append(identifier)
        if note is not None:
            notes.append(
                {"field": "element_types", "identifier": identifier, "text": note}
            )
    return types, notes


def parse_operators(raw_text):
    """One operator per line: a name, then zero or more element types."""
    operators = {}
    for line in raw_text.splitlines():
        if not line.strip():
            continue
        name, *types = line.split()
        operators[name] = types
    return operators


def parse_boolean(raw_text):
    """For --optimised-disjunctive-reasoning and --serialise-assignments."""
    text = raw_text.strip()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def expand_closure(field_name, reported_identifiers):
    """The 'satisfies' computation: the union of each identifier's closure."""
    closure = CLOSURE[field_name]
    satisfied = set()
    for identifier in reported_identifiers:
        satisfied.update(closure.get(identifier, []))
    return [value for value in PERMITTED_VALUES[field_name] if value in satisfied]


def _failure_reason(returncode, stderr_text):
    """One short phrase naming what went wrong, for an errors[] entry."""
    detail = " | ".join(l.strip() for l in stderr_text.splitlines() if l.strip())
    if returncode == TIMEOUT_RETURNCODE:
        return detail or f"timed out after {QUERY_TIMEOUT_SECONDS} seconds"
    return f"exited {returncode}: {detail}" if detail else f"exited {returncode}"


def collect(binary, solver_id, version):
    """Run all 13 commands against `binary` and assemble one version record."""
    errors = []
    notes = []
    capabilities = {}
    satisfies = {}

    returncode, stdout, stderr = run_query(binary, "--name")
    if returncode != 0:
        errors.append(f"--name: {_failure_reason(returncode, stderr)}")
    elif not stdout.strip():
        errors.append("--name: produced no output")

    returncode, stdout, stderr = run_query(binary, "--version")
    if returncode != 0:
        errors.append(f"--version: {_failure_reason(returncode, stderr)}")
    elif not stdout.strip():
        errors.append("--version: produced no output")
    else:
        reported = stdout.strip().splitlines()[0].strip()
        if reported != version:
            errors.append(
                f"--version: reported {reported!r}, "
                f"submission directory says {version!r}"
            )

    for flag in SUPPORTS_FLAGS:
        field = THEORY_FLAGS.get(flag) or OTHER_FLAGS[flag]
        is_theory = flag in THEORY_FLAGS

        returncode, stdout, stderr = run_query(binary, "supports", flag)

        if returncode != 0:
            errors.append(f"{flag}: {_failure_reason(returncode, stderr)}")
            value = None
        elif not stdout.strip():
            errors.append(f"{flag}: produced no output")
            value = None
        elif is_theory:
            identifiers, field_notes, field_errors = parse_theory_output(stdout, field)
            notes.extend(field_notes)
            errors.extend(f"{flag}: {message}" for message in field_errors)
            value = None if field_errors else identifiers
        elif flag == "--onnx-opset-versions":
            value = parse_opset(stdout)
            if value is None:
                errors.append(f"{flag}: expected two integer lines, got {stdout.strip()!r}")
        elif flag == "--vnnlib-versions":
            value = parse_vnnlib_versions(stdout)
            if value is None:
                errors.append(f"{flag}: expected two version lines, got {stdout.strip()!r}")
        elif flag == "--onnx-element-types":
            value, field_notes = parse_element_types(stdout)
            notes.extend(field_notes)
        elif flag == "--onnx-operators":
            value = parse_operators(stdout)
        else:
            value = parse_boolean(stdout)
            if value is None:
                errors.append(f"{flag}: expected 'true' or 'false', got {stdout.strip()!r}")

        capabilities[field] = value
        if is_theory:
            satisfies[field] = expand_closure(field, value or [])

    record = {
        "version": version,
        "collected_at": schema.now_iso(),
        "status": "ok" if not errors else "incomplete",
    }
    if errors:
        record["errors"] = errors
    record["capabilities"] = capabilities
    record["satisfies"] = satisfies
    if notes:
        record["notes"] = notes
    return record
