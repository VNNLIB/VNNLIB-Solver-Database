#!/usr/bin/env python3
"""
report.py — render register.py's records as markdown, for a pull request
comment or an Actions job summary.

Presentation only: it reads the same JSON Lines build.py merges and writes
nothing. Kept out of the workflow YAML because a heredoc full of jq is not
something anyone can test.

    python3 scripts/report.py results.jsonl > report.md

Testing: see tests/README.md.
"""

import json
import sys
from pathlib import Path

# What each status means to the person reading the comment, rather than what
# it means to the schema.
VERDICT = {
    "ok": "All eleven capability queries answered. This is what will be recorded.",
    "incomplete": "Installed, but some queries were unusable. The rest is still recorded.",
    "install_failed": "Never installed, so nothing could be asked of it.",
    "non_conforming": "Runs, but does not implement the VNN-LIB 2.0 CLI.",
}

# Capability fields worth showing in a summary table. The rest are in the
# collapsed JSON below it.
HIGHLIGHTS = [
    ("vnnlib_versions", "VNN-LIB"),
    ("onnx_opset", "ONNX opset"),
    ("arithmetic", "Arithmetic"),
    ("multiple_networks", "Networks"),
]


def _cell(value):
    if value is None:
        return "—"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) if value else "(none)"
    return str(value)


def render_solver(solver):
    """One solver's section."""
    lines = []
    for record in solver["versions"]:
        status = record["status"]
        lines.append(f"### `{solver['id']}` {record['version']} — **{status}**")
        lines.append("")
        lines.append(VERDICT.get(status, "Unrecognised status."))
        lines.append("")

        if record.get("errors"):
            lines.append("<details><summary>Problems</summary>")
            lines.append("")
            for error in record["errors"]:
                lines.append(f"- `{error}`")
            lines.append("")
            lines.append("</details>")
            lines.append("")

        capabilities = record.get("capabilities")
        if capabilities:
            lines.append("| | |")
            lines.append("|---|---|")
            for field, label in HIGHLIGHTS:
                lines.append(f"| {label} | {_cell(capabilities.get(field))} |")
            lines.append("")

            lines.append("<details><summary>Everything recorded</summary>")
            lines.append("")
            lines.append("```json")
            lines.append(json.dumps(record, indent=2))
            lines.append("```")
            lines.append("")
            lines.append("</details>")
            lines.append("")

        if record.get("notes"):
            lines.append("Caveats the solver attached to its own answers:")
            lines.append("")
            for note in record["notes"]:
                where = note.get("identifier") or "general"
                lines.append(f"- **{where}** {note['text']}")
            lines.append("")

    return lines


def render(solvers):
    """The whole report."""
    if not solvers:
        return "## Capability collection\n\nNo submissions were collected.\n"

    lines = ["## Capability collection", ""]
    statuses = [v["status"] for s in solvers for v in s["versions"]]
    lines.append(
        f"{len(solvers)} solver(s), {len(statuses)} release(s): "
        + ", ".join(f"{statuses.count(s)} {s}" for s in sorted(set(statuses)))
    )
    lines.append("")

    for solver in solvers:
        lines += render_solver(solver)

    lines.append("---")
    lines.append(
        "A recorded failure is not a rejection — the solver still appears in "
        "the database, marked with what went wrong. See "
        "[docs/SUBMITTING.md](docs/SUBMITTING.md)."
    )
    return "\n".join(lines) + "\n"


def load(path):
    """The JSON Lines register.py wrote, or [] if the run never got that far."""
    path = Path(path)
    if not path.exists():
        return []
    solvers = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            solvers.append(json.loads(line))
    return solvers


def main():
    if len(sys.argv) != 2:
        print("usage: report.py <results.jsonl>", file=sys.stderr)
        return 2
    print(render(load(sys.argv[1])), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
