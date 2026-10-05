# The HTTP API

Read-only. Serves `data/solvers.json` and answers the reverse of a solver's
`supports` command: *given what I need, which solvers can do it?*

```bash
pip install -r api/requirements.txt

python3 api/app.py                    # data/solvers.json, the real database
python3 api/app.py --dev              # tests/fixtures/solvers.demo.json
python3 api/app.py --database PATH    # anything else
python3 api/app.py --port 8080
```

It prints which file it is serving at startup. A WSGI host imports this module
rather than running it, so set `SOLVERS_JSON` there instead.

Deployment is in [DEPLOY.md](DEPLOY.md).

## Endpoints

| | |
|---|---|
| `GET /` | schema version, when the data was generated, what you can filter on |
| `GET /health` | liveness, and whether the database file is present |
| `GET /solvers` | everything, including releases that failed to install |
| `GET /solvers/<id>` | one solver, 404 if unknown |
| `GET /search?...` | filter; returns solvers with only their matching releases |
| `GET /vocabulary` | every operator name and element type any solver reports |

Every response carries `Access-Control-Allow-Origin: *`.

`/` and `/health` report `"source"`: `collected` for the real database, `demo`
for the fixture. Check it before trusting the numbers.

## Filtering

```
/search?arithmetic=POLY
/search?operators=Conv,Relu&element_types=float32
/search?onnx_opset=16&vnnlib_versions=2.0
/search?hidden_nodes=H&multiple_networks=MNET
```

Criteria combine with AND; repeats and commas both mean "all of these". A
misspelled filter is a 400, not a silent match-everything.

**Theory fields are matched against `satisfies`, not `capabilities`,** so
`?arithmetic=OUTC` matches a solver that only reported `POLY`.

**Operators take an optional element type.**

```
/search?operators=Conv            # supports Conv at all
/search?operators=Conv:float64    # supports Conv for float64
```

An operator listed with no types supports *every* type in that solver's
`element_types`, so `Relu:float64` matches a solver that printed a bare `Relu`
and lists `float64`.

**Booleans take `true` or `false`.** Anything else is a 400. A release whose
answer was unusable, so the field is `null`, matches neither value.

```
/search?serialise_assignments=true
```

**Ranges take a single value.** `onnx_opset` and `vnnlib_versions` are stored as
inclusive `[min, max]` pairs, so `?onnx_opset=16` asks whether 16 falls in range.

## Sorting, paging and the name

| | |
|---|---|
| `name` | substring of the display name or the id, case-insensitive |
| `sort` | `name-asc`, `name-desc`, `version-asc`, `version-desc`, `date-asc`, `date-desc`. Default `date-desc` |
| `limit` | page size. Default 10, capped at 200 |
| `offset` | how many results to skip |

```
/search?arithmetic=POLY&sort=name-asc&limit=10&offset=20
```

The response carries `solvers`, the requested page, and `total`, the size of the
whole result set before `limit` and `offset`.

An unknown `sort` is a 400. A `limit` or `offset` that is not a number falls
back to the default.

## /vocabulary

```json
{
  "operators": { "Conv": ["float32", "float64"], "MatMul": ["real"] },
  "element_types": ["float16", "float32"],
  "generated_at": "2026-09-25T15:30:28Z"
}
```

The types beside an operator are the explicit lists plus, for any solver that
listed the operator bare, that solver's whole `element_types`.

## What a search result carries

Each solver has its `versions` narrowed to the releases that matched, plus a
`matches` object:

```json
{
  "id": "testsolver11",
  "name": "TestSolver Eleven",
  "versions": [ "... only the matching records ..." ],
  "matches": {
    "ranges": [
      { "from": "1.0.0", "to": "1.1.0", "versions": ["1.0.0", "1.1.0"] },
      { "from": "2.1.0", "to": "2.1.0", "versions": ["2.1.0"] }
    ],
    "latest": { "version": "2.1.0", "collected_at": "2026-09-24T00:00:00Z" },
    "matched": 3,
    "total": 5
  }
}
```

`ranges` is a list of **consecutive runs**, not one span. Two releases are
consecutive when they are adjacent in the solver's `versions` array, which
SCHEMA.md makes a sorted list, so no version string is parsed here. A run of one
has `from` equal to `to`.

`latest` is the newest matching release. `matched` and `total` say how many of
the solver's releases qualified out of how many it has.

**Releases that never installed never match**, not even an empty query. They are
still visible through `/solvers`.

## Tests

```bash
python3 tests/unit/api.py
```

Flask's test client: no server, no port, no network.
