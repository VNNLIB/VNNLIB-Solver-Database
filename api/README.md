# The HTTP API

Read-only. Serves `data/solvers.json` and answers the reverse question a
solver's `supports` command cannot: *given what I need, which solvers can do
it?*

```bash
pip install -r api/requirements.txt

python3 api/app.py                    # data/solvers.json — the real database
python3 api/app.py --dev              # tests/fixtures/solvers.demo.json
python3 api/app.py --database PATH    # anything else
python3 api/app.py --port 8080
```

It prints which file it is serving at startup, because serving the demo
fixture while believing it is the real database is the one mistake `--dev`
makes easy. Under gunicorn there is no command line, so `SOLVERS_JSON` does
the same job.

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

**Operators can be asked for with or without an element type.**

```
/search?operators=Conv            # supports Conv at all
/search?operators=Conv:float64    # supports Conv for float64
```

An operator listed with **no** types supports *every* type in that solver's
`element_types`, not none — Section 5.4.1 says so, and reading the empty list
backwards would silently exclude the solvers that support the most. So
`Relu:float64` matches a solver that printed a bare `Relu` and lists `float64`
among its element types.

Caveat: no solver observed so far prints a type list at all — vibecheck
reports 51 bare operator names. The typed shape comes from SCHEMA.md's
example, so the `Name:type` filter is written to the specification, not to
observed output.

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
