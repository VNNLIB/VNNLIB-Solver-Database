#!/usr/bin/env python3
"""
collect.py — ask an already-running solver binary what it supports, and turn
its answers into the shapes defined in docs/SCHEMA.md.

This module never touches installation, venvs, or subprocesses that install
anything — it only ever calls an executable that already exists on PATH and
parses what it prints. register.py is the only caller that needs to know
anything about how that binary got there.

HOW TO TEST
-----------
1. Unit tests. No solver, no venv, no network — run_query is stubbed out.

       python3 tests/unit/collect.py

2. Against a fake solver, end to end. Needs bash, so WSL or Linux; Windows
   Python cannot exec a shebang script through subprocess.

       mkdir -p /tmp/solverbin
       SOLVER_BIN_DIR=/tmp/solverbin tests/fixtures/testsolver/1.0.0/install.sh
       cd scripts
       PATH=/tmp/solverbin:$PATH python3 -c "import collect, json; \
           print(json.dumps(collect.collect('testsolver', 'testsolver', '1.0.0'), indent=2))"

   testsolver answers everything correctly and should collect as "ok". Swap in
   tests/fixtures/brokensolver/0.9.0 (id brokensolver, version 0.9.0) for the
   "incomplete" path: it breaks five flags in five different ways.

3. Against a real solver, once register.py exists. vibecheck pulls torch and
   takes minutes per run, so leave it until 1 and 2 both pass.
"""

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

# Maps each theory-set flag to the schema field name it fills in.
THEORY_FLAGS = {
    "--hidden-node-theories": "hidden_nodes",
    "--multiple-input-output-theories": "multiple_io",
    "--multiple-network-theories": "multiple_networks",
    "--multiple-node-comparison-theories": "node_comparisons",
    "--arithmetic-complexity-theories": "arithmetic",
}

# Every other supports flag, and the schema field it fills in.
OTHER_FLAGS = {
    "--onnx-opset-versions": "onnx_opset",
    "--onnx-element-types": "element_types",
    "--onnx-operators": "operators",
    "--vnnlib-versions": "vnnlib_versions",
    "--optimised-disjunctive-reasoning": "optimised_disjunction",
    "--serialise-assignments": "serialise_assignments",
}

# Catches the two tables drifting apart if a twelfth flag is ever added.
assert set(THEORY_FLAGS) | set(OTHER_FLAGS) == set(SUPPORTS_FLAGS)

# The only identifiers each field is allowed to report. Anything else is a
# conformance failure, not an unknown value to shrug off.
PERMITTED_VALUES = {
    "hidden_nodes": ["NH", "H"],
    "multiple_io": ["SIO", "MIO"],
    "multiple_networks": ["SNET", "MENET", "MINET", "MNET"],
    "node_comparisons": ["SNC", "MNC"],
    "arithmetic": ["BND", "OUTC", "LIN", "POLY"],
}

# Chapter 4 downward closure, per docs/SCHEMA.md's "Satisfies" table.
# Note SNET and MENET are disjoint, not nested.
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

# One supports query is a print statement, not a proof search.
QUERY_TIMEOUT_SECONDS = 60

# Conventional shell exit code for "killed by timeout".
TIMEOUT_RETURNCODE = 124


def run_query(binary, *args):
    """
    Run `binary *args` with a short timeout, capturing stdout/stderr.

    Return (returncode, stdout_text, stderr_text). Must NOT raise on a
    non-zero exit or a timeout — the caller decides what that means. A
    timeout looks like a failed returncode, with the timeout noted in
    stderr_text.
    """
    command = [str(binary), *[str(a) for a in args]]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=QUERY_TIMEOUT_SECONDS,
            # A solver that reads stdin would otherwise hang until the timeout.
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
    """
    'POLY * some note' -> ('POLY', '* some note')
    'POLY'              -> ('POLY', None)

    Identifier is the first token; note is everything after it, unstripped of
    its delimiter — per docs/SCHEMA.md, text keeps whatever trailed the
    identifier, since the collector doesn't assume the delimiter looks like
    '* ', only that something separates the two.

    Splits on any whitespace, not just a space. A solver separating the two
    with a tab is still printing a valid identifier, and SCHEMA.md's rule is
    that capabilities are "normalised only for whitespace".
    """
    parts = line.split(None, 1)
    if not parts:
        return "", None
    identifier = parts[0]
    note = parts[1].strip() if len(parts) > 1 else None
    return identifier, note


def parse_theory_output(raw_text, field_name):
    """
    Turn the raw stdout of one theory-set flag into (identifiers, notes,
    errors): recognised values in PERMITTED_VALUES order, one note dict per
    line carrying a note, and one error per line that is not a recognised
    identifier at all. Never raises — bad output is data to record.
    """
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
    # PERMITTED_VALUES order, so two solvers reporting the same set produce
    # identical records whatever order they printed them in.
    identifiers = [value for value in permitted if value in seen]
    return identifiers, notes, errors


def parse_min_max(raw_text, converter=None):
    """
    Shared shape behind parse_opset and parse_vnnlib_versions: exactly two
    non-blank lines, min then max. Returns None if the line count is wrong,
    or if converter fails on either line.
    """
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
    """
    --onnx-opset-versions prints two lines, min then max. Returns [min, max]
    as ints, or None if that isn't what came back; the caller records the
    error and leaves the field null.

    min > max is rejected too. Such a range can never contain anything, so
    keeping it would silently exclude the solver from every opset query
    instead of telling its author the two lines are the wrong way round.
    """
    pair = parse_min_max(raw_text, converter=int)
    if pair is None or pair[0] > pair[1]:
        return None
    return pair


def parse_vnnlib_versions(raw_text):
    """
    --vnnlib-versions has the same two-line shape, but these are version
    strings ('1.0', '2.0'), so they are not coerced to numbers.
    """
    return parse_min_max(raw_text)


def parse_element_types(raw_text):
    """
    One type name per line (ONNX Set 1 names, plus 'real'), with any ' * note'
    suffix split off. No ordering between them — float64 does not imply
    float32 — so input order is kept. Returns (types, notes).
    """
    types = []
    notes = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line:
            continue
        identifier, note = split_note(line)
        # No allowlist: SCHEMA.md doesn't enumerate the permitted names, and
        # inventing that list here would reject types the standard allows.
        if identifier not in types:
            types.append(identifier)
        if note is not None:
            notes.append(
                {"field": "element_types", "identifier": identifier, "text": note}
            )
    return types, notes


def parse_operators(raw_text):
    """
    One operator per line: a name, then zero or more element types.

        'Conv float64 float32'  ->  {'Conv': ['float64', 'float32']}
        'Relu'                  ->  {'Relu': []}

    The empty list is stored as printed, NOT expanded. Section 5.4.1 says an
    empty type list means every type in element_types, not none — but that is
    a reading, and SCHEMA.md's rule is that capabilities holds exactly what
    the solver printed. Expanding here would also freeze today's element_types
    into a record whose solver actually said "all of them".

    Consumers do the expansion; api/app.py's operator_matches is the example.
    """
    operators = {}
    for line in raw_text.splitlines():
        if not line.strip():
            continue
        name, *types = line.split()
        operators[name] = types
    return operators


def parse_boolean(raw_text):
    """
    For --optimised-disjunctive-reasoning and --serialise-assignments.
    Returns True, False, or None if it is neither.

    Exactly 'true' or 'false', case-sensitive. A solver printing 'Yes' is not
    conforming, and the caller records that as an error rather than guessing —
    the same treatment a theory field gets for an identifier outside its
    permitted set. Guessing would silently record False for any spelling not
    anticipated, which is a wrong answer dressed as a real one.
    """
    text = raw_text.strip()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def expand_closure(field_name, reported_identifiers):
    """
    The 'satisfies' computation: union the closures of every reported
    identifier, returned in PERMITTED_VALUES order.
    """
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
    """
    Call all 13 commands (--name, --version, and every flag in SUPPORTS_FLAGS)
    against `binary`, and assemble one version record matching SCHEMA.md's
    "Version" table.

    status is "ok" only if every command ran (exit 0) AND parsed into a
    permitted value. Any single failure downgrades the record to "incomplete"
    without aborting collection of the rest.

    Never returns "install_failed" — that is register.py's call to make.
    """
    errors = []
    notes = []
    capabilities = {}
    satisfies = {}

    # Neither global option lands in the record: the Version table has no name
    # field (register.py queries --name itself), and version comes from the
    # submission directory. They are still queried because a solver that can't
    # answer them is not conforming, and that belongs in errors[].
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
            # Cross-check, not a correction: the directory name still wins.
            errors.append(
                f"--version: reported {reported!r}, "
                f"submission directory says {version!r}"
            )

    # SUPPORTS_FLAGS order, so capabilities keys land in SCHEMA.md's order.
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
            # One bad line nulls the field: a partial list would assert more
            # than was actually established.
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
            # Null field -> [], per SCHEMA.md's brokennn record. The key is
            # always present so consumers never need a None check.
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
