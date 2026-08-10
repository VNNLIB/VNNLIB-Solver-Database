# `data/solvers.json` — field reference

The collection pipeline writes to the solver database, the `vnnfilter`
package and the website fetches it. 

Every field traces back to a specific command in Section 5 of the VNN-LIB 2.0
standard. Nothing here is invented.

---

## Design rules

**Raw before derived.** `capabilities` holds exactly what the solver printed,
normalised only for whitespace. Anything computed from it is either stored
separately or not stored at all.

**Store knowledge, compute arithmetic.** A derived value is only written into
the file if deriving it needs information from outside the file. The Chapter 4
subset relations live in the standard, so `satisfies` is stored. Version ranges
are pure grouping over `versions[]`, so they are not.

**Never assert what was not measured.** Only releases that were actually
installed and queried appear. No interpolation between them.

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
| `partial_support` | when the solver flagged any | Caveats the solver attached to specific identifiers |

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

## Partial support

Some solvers qualify a capability rather than claiming it outright. vibecheck
writes `IDENT * note` on the relevant output line:

```
BND
OUTC
LIN
POLY * polynomial constraints transpiled via nonlinear-augment
```

**This notation is not in the standard.** A parser assuming a bare identifier
rejects all four of those lines and marks a fully conforming solver as broken.

The identifier stays in `capabilities`, the note goes here:

```json
"partial_support": {
  "arithmetic": { "POLY": "polynomial constraints transpiled via nonlinear-augment" }
}
```

A partially supported capability still matches a search. The user is better
placed than we are to judge whether the caveat matters to them, so it is shown
alongside the result rather than used to exclude it.

---

## Derived at read time, not stored

**Version ranges.** Displayed as "2.0.0 to 2.1.0 supports this". 

**Latest version.** The last element of `versions`.

**Whether a solver matches a query.** Computed by `vnnfilter`.

---
