# `data/solvers.json`: field reference
The database only currently working solvers that are not withdrawn. Every field comes from a command in Section 5 of the VNN-LIB 2.0 standard.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | string | `MAJOR.MINOR`. A reader should refuse a file whose major version it does not know |
| `generated_at` | string | ISO 8601 UTC of the run that produced the file |
| `solvers` | array | One entry per solver, in no guaranteed order |

Current version is `2.0`. In `1.0` the solver field `url` was called `repo`.

## Solver

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Directory name under `solvers/`. Lowercase, alphanumeric and hyphens. Never changes once assigned |
| `name` | string | Display name, from `solver.toml` or from `--name` |
| `url` | string | The solver's repository, project site or documentation |
| `versions` | array | One entry per release, **sorted ascending**. The ordering is part of the contract |

There is no `latest_version`; it is the last element of `versions`.

## Version

| Field | Present | Meaning |
|---|---|---|
| `version` | always | Release identifier, from the submission directory name |
| `collected_at` | always | ISO 8601 UTC of when this release was installed and queried |
| `status` | always | See below |
| `errors` | when not `ok` | One entry per failure, naming the command and what was observed |
| `capabilities` | unless install failed | What the solver reported |
| `satisfies` | unless install failed | Downward closure of the reported theories |
| `notes` | when the solver attached any | Free-text caveats |

### Status values

| Value | Meaning | `capabilities` |
|---|---|---|
| `ok` | All queries returned valid output | full |
| `incomplete` | Installed, some queries unusable | present, `null` per unusable field |
| `non_conforming` | Runs, but does not implement the VNN-LIB 2.0 CLI | absent |
| `install_failed` | Script failed, timed out, or left no executable | absent |

**Only `ok` records are published**, so `status` is always `ok` in this file.
The other values appear in the pull request comment on a submission.

Test for the absence of `capabilities` rather than for a particular status
string.

---

## Capabilities

### ONNX

| Field | Source | Type | Meaning |
|---|---|---|---|
| `onnx_opset` | `--onnx-opset-versions` | `[min, max]` | Inclusive |
| `element_types` | `--onnx-element-types` | array | ONNX Set 1 names plus `real`. No ordering among themselves: `float64` does not imply `float32` |
| `operators` | `--onnx-operators` | object | Operator name to the element types restricting it |

**An empty operator type list means every type in `element_types`, not none.**

### Queries

| Field | Source | Permitted values |
|---|---|---|
| `vnnlib_versions` | `--vnnlib-versions` | `[min, max]`, inclusive |
| `hidden_nodes` | `--hidden-node-theories` | `NH` no hidden node declarations, `H` may declare them |
| `multiple_io` | `--multiple-input-output-theories` | `SIO` one input and one output, `MIO` arbitrarily many |
| `multiple_networks` | `--multiple-network-theories` | `SNET` one network, `MENET` two or more all but one carrying `equal-to`, `MINET` same but allowing `isomorphic-to`, `MNET` arbitrarily many |
| `node_comparisons` | `--multiple-node-comparison-theories` | `SNC` no assertion compares different nodes of the same network, `MNC` such comparisons allowed |
| `arithmetic` | `--arithmetic-complexity-theories` | `BND` variable against constant, `OUTC` comparisons between hidden or output variables, `LIN` linear expressions, `POLY` polynomial |
| `optimised_disjunction` | `--optimised-disjunctive-reasoning` | boolean |

Each theory field is an **array**: a solver may report the strongest theory it
supports or the full set. Any value outside the permitted set makes that field
`null` and the record `incomplete`.

### Other

| Field | Source | Meaning |
|---|---|---|
| `serialise_assignments` | `--serialise-assignments` | Whether the solver can write assignments as ONNX `TensorProto` files |

---

## Satisfies

The downward closure of each reported theory set, so consumers can match with a
containment test.

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

A solver may qualify a capability rather than claiming it outright, by writing
the caveat after the identifier on that output line:

```
POLY * polynomial constraints transpiled via nonlinear-augment
```

`notes` is a flat list. `field` and `identifier` are filled in only when the
note could be tied to one capability, and are `null` otherwise. `text` keeps
everything that followed the identifier, delimiter included.

```json
"notes": [
  { "field": "arithmetic", "identifier": "POLY",
    "text": "* polynomial constraints transpiled via nonlinear-augment" },
  { "field": null, "identifier": null,
    "text": "a caveat that could not be tied to one capability" }
]
```

A note never changes whether a capability is reported, and a capability with a
note still matches a search.

---

## Not stored

Version ranges, the latest version, and whether a solver matches a query are all
derived when the file is read.
