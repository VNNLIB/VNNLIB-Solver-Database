# The HTTP API

Read-only. Serves `data/solvers.json` and answers the reverse question a
solver's `supports` command cannot: *given what I need, which solvers can do
it?*

```bash
pip install -r api/requirements.txt
python3 api/app.py                                  # http://127.0.0.1:5000
SOLVERS_JSON=tests/fixtures/solvers.demo.json python3 api/app.py
```

## Endpoints

| | |
|---|---|
| `GET /` | schema version, when the data was generated, what you can filter on |
| `GET /health` | liveness, and whether the database file is present |
| `GET /solvers` | everything, including releases that failed to install |
| `GET /solvers/<id>` | one solver, 404 if unknown |
| `GET /search?...` | filter; returns solvers with only their matching releases |

## Filtering

```
/search?arithmetic=POLY
/search?operators=Conv,Relu&element_types=float32
/search?onnx_opset=16&vnnlib_versions=2.0
/search?hidden_nodes=H&multiple_networks=MNET
```

Criteria combine with AND, and repeats or commas both mean "all of these".
Anything you leave out is ignored rather than assumed. A misspelled filter is
a 400, not a silent match-everything.

**Theory fields are matched against `satisfies`, not `capabilities`.** The
downward closure is already computed there, so `?arithmetic=OUTC` correctly
matches a solver that only ever reported `POLY`.

**Operators are matched by name only.** SCHEMA.md warns that an empty type
list after an operator name means *every* type in `element_types`, not none —
matching on the name is the reading that cannot be got backwards.

**Ranges take a single value.** `onnx_opset` and `vnnlib_versions` are stored
as inclusive `[min, max]` pairs, so `?onnx_opset=16` asks "does 16 fall in
your range".

**Releases that never installed never match**, not even an empty query. Search
answers "what can do this", and nothing was measured about them — they are
still visible through `/solvers`.

## Serving it for real

`app.run()` is the development server. In front of anything public:

```bash
gunicorn --chdir . --workers 2 --bind 0.0.0.0:8000 api.app:app
```

The data is a static file that a workflow updates, so the process re-reads it
whenever its mtime changes — a new commit is picked up without a restart, and
requests in between do not re-parse the JSON.

Worth knowing before paying for hosting: because it *is* a static file,
`raw.githubusercontent.com/<user>/<repo>/main/data/solvers.json` already
serves the same data over HTTP for free, with no server to operate. This API
exists for the filtering, not for the file.

## Tests

```bash
python3 tests/unit/api.py
```

19 checks against Flask's test client — no server, no port, no network.
