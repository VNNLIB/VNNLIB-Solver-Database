# `data/solvers.json` — field reference

The collection pipeline writes to the solver database, the `vnnfilter`
package and the website fetches it. 

Every field traces back to a specific command in Section 5 of the VNN-LIB 2.0
standard. Nothing here is invented.

---

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | string | `MAJOR.MINOR`. Bumped on any change that could break a reader, so consumers can refuse a file they do not understand rather than half-reading it |
| `generated_at` | string | ISO 8601 UTC of the run that produced the file |
| `solvers` | array | One entry per registered solver, in no guaranteed order |

## Solver

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Directory name under `solvers/`. Lowercase, alphanumeric and hyphens. Appears in URLs and citations, so it never changes once assigned |
| `name` | string | Display name, from `solver.toml` or failing that from `--name` |
| `repo` | string | Canonical source URL, normalised. The uniqueness key for detecting the same solver submitted twice |
| `versions` | array | One entry per release collected, **sorted ascending**. Consumers rely on the ordering to compute ranges without parsing versions, so it is part of the contract |

There is no `latest_version`. It is the last element of `versions`.

## Version

| Field | Present | Meaning |
|---|---|---|
| `version` | always | Release identifier, from the submission directory name, cross-checked against `--version` |
| `collected_at` | always | ISO 8601 UTC of when this release was installed and queried |
| `status` | always | See below |
| `errors` | when not `ok` | One entry per failure, naming the command and what was observed |
| `capabilities` | unless install failed | What the solver reported |
| `satisfies` | unless install failed | Downward closure of the reported theories |
| `notes` | when the solver attached any | Free-text caveats, linked to a specific capability where that was possible to tell, otherwise general |

### Status values

| Value | Meaning | `capabilities` |
|---|---|---|
| `ok` | All eleven queries returned valid output | full |
| `incomplete` | Installed, some queries unusable | present, with `null` per unusable field |
| `non_conforming` | Runs, but does not implement the VNN-LIB 2.0 CLI | absent |
| `install_failed` | Script failed, timed out, or left no executable | absent |

`non_conforming` exists because "installed fine but does not speak 2.0" is a
different problem from "your install script is broken", and the submitter needs
to be told which. Marabou is the concrete case: it installs perfectly from
`pip install maraboupy` and then crashes on every `supports` query, because it
predates the interface.

**Read the absence of `capabilities`, not the status string.** Code that tests
`status == "install_failed"` breaks the day a fifth status is added.

---

## Capabilities

### ONNX capabilities, Section 5.4.1

| Field | Source | Type | Meaning |
|---|---|---|---|
| `onnx_opset` | `--onnx-opset-versions` | `[min, max]` | Inclusive. The command prints exactly two lines, so the array keeps that shape without inventing key names |
| `element_types` | `--onnx-element-types` | array | ONNX Set 1 names plus `real`. Order not meaningful, and these have **no ordering among themselves**: `float64` does not imply `float32`. A solver must report `real` rather than a concrete type where its analysis is not sound for that type |
| `operators` | `--onnx-operators` | object | Key is the operator name, case-sensitive as in ONNX. Value is the element types restricting it |

**An empty operator type list means every type in `element_types`, not none.**
Section 5.4.1 says so explicitly, and it is the single easiest thing in this
file to get backwards. Filtering by operator name alone avoids the trap.

### Query capabilities, Section 5.4.2

| Field | Source | Permitted values |
|---|---|---|
| `vnnlib_versions` | `--vnnlib-versions` | `[min, max]`, inclusive |
| `hidden_nodes` | `--hidden-node-theories` | `NH` no hidden node declarations, `H` may declare them |
| `multiple_io` | `--multiple-input-output-theories` | `SIO` one input and one output, `MIO` arbitrarily many |
| `multiple_networks` | `--multiple-network-theories` | `SNET` one network, `MENET` two or more all but one carrying `equal-to`, `MINET` same but allowing `isomorphic-to`, `MNET` arbitrarily many |
| `node_comparisons` | `--multiple-node-comparison-theories` | `SNC` no assertion compares different nodes of the same network, `MNC` such comparisons allowed |
| `arithmetic` | `--arithmetic-complexity-theories` | `BND` variable against constant, `OUTC` comparisons between hidden or output variables, `LIN` linear expressions, `POLY` polynomial |
| `optimised_disjunction` | `--optimised-disjunctive-reasoning` | boolean |

Each theory field is an **array**. The standard says the output is "a
newline-separated list of theories", and a solver may report the strongest it
supports or the full set. Both readings fit; `satisfies` normalises them.

Any value outside the permitted set is a conformance failure: that field becomes
`null` and the record becomes `incomplete`.

### Other, Section 5.4.3

| Field | Source | Meaning |
|---|---|---|
| `serialise_assignments` | `--serialise-assignments` | Whether the solver can write assignments as ONNX `TensorProto` files. Irrelevant to search; recorded because the standard makes reporting it mandatory |

---

## Satisfies

For each theory set, the downward closure of what was reported. If a solver
handles every query in theory `T`, and `S` is a subset of `T`, it handles every
query in `S` too.

This exists so consumers match with a containment test and nothing more. Without
it, the package and the website would each embed the closure tables, and would
eventually disagree.

| Set | Reported | Closure |
|---|---|---|
| Hidden nodes | `NH` | `NH` |
| | `H` | `NH`, `H` |
| Inputs/outputs | `SIO` | `SIO` |
| | `MIO` | `SIO`, `MIO` |
| Multiple networks | `SNET` | `SNET` |
| | `MENET` | `MENET` |
| | `MINET` | `MENET`, `MINET` |
| | `MNET` | `SNET`, `MENET`, `MINET`, `MNET` |
| Node comparisons | `SNC` | `SNC` |
| | `MNC` | `SNC`, `MNC` |
| Arithmetic | `BND` | `BND` |
| | `OUTC` | `BND`, `OUTC` |
| | `LIN` | `BND`, `OUTC`, `LIN` |
| | `POLY` | `BND`, `OUTC`, `LIN`, `POLY` |

---

## Notes

Some solvers qualify a capability rather than claiming it outright. vibecheck
writes `IDENT * note` on the relevant output line:

```
BND
OUTC
LIN
POLY * polynomial constraints transpiled via nonlinear-augment
```

**This notation is not in the standard, and nothing says another solver will
use it, or use it the same way.** It is vibecheck's own convention. The
collector matches a recognised identifier at the start of a line and treats
anything trailing it as a note, but that is opportunistic parsing of one
solver's habit, not a rule every solver is expected to follow. A future
solver's caveat might not attach to a single identifier at all.

So `notes` is a flat list, not a structure keyed by field and identifier.
Each entry records the note text, plus a field and identifier **only when
the parser was actually able to tell what the note was about**:

```json
"notes": [
  { "field": "arithmetic", "identifier": "POLY",
    "text": "* polynomial constraints transpiled via nonlinear-augment" },
  { "field": null, "identifier": null,
    "text": "a caveat some other solver attached in a way that could not be tied to one capability" }
]
```

**`text` keeps everything that trailed the identifier, delimiter included —
it is not stripped.** The collector does not assume the delimiter looks like
`* `, only that *something* separates the identifier from the note; stripping
a specific character would itself be an assumption about vibecheck's own
convention leaking into code meant to stay generic across solvers. So for
vibecheck today, `text` starts with `* `; a solver using a different
convention would produce whatever it prints trailing its identifier,
unmodified.

The identifier itself still stays in `capabilities` either way — `notes` only
ever adds the caveat text, never changes whether a capability is reported.

A capability with a note still matches a search; `field`/`identifier` are what
let a consumer show the note next to the right result when it can, and fall
back to showing it against the solver generally when it can't. The user is
better placed than we are to judge whether a caveat matters to them, so it is
surfaced rather than used to exclude a match.

---

## Derived at read time, not stored

**Version ranges.** Displayed as "2.0.0 to 2.1.0 supports this". 

**Latest version.** The last element of `versions`.

**Whether a solver matches a query.** Computed by `vnnfilter`.

---
