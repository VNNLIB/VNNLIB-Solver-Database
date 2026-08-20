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
makes easy. A WSGI host imports this module rather than running it, so there
is no command line there — `SOLVERS_JSON` does the same job.

## Endpoints

| | |
|---|---|
| `GET /` | schema version, when the data was generated, what you can filter on |
| `GET /health` | liveness, and whether the database file is present |
| `GET /solvers` | everything, including releases that failed to install |
| `GET /solvers/<id>` | one solver, 404 if unknown |
| `GET /search?...` | filter; returns solvers with only their matching releases |

Every response carries `Access-Control-Allow-Origin: *`, so a page on another
origin — the Stage 3 search page, or anyone's script — can read it. The data
is public and read-only, and there is no session or credential involved.

`/` and `/health` report `"source"`: `collected` for the real database,
`demo` for the fixture. Anyone building against this should check it before
trusting the numbers.

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

## Hosting it on PythonAnywhere

Free tier, no card, and `.github.com` / `.githubusercontent.com` are on their
whitelist, so `git pull` works.

**1. Get the code there.** Bash console:

```bash
git clone https://github.com/<you>/VNNLIB-Solver-Database.git
mkvirtualenv --python=/usr/bin/python3.13 solverdb
pip install flask
```

**2. Web tab → Add a new web app → Manual configuration**, same Python
version. Set **Virtualenv** to `solverdb`.

**3. Edit the WSGI file** (link near the top of the Web tab). Delete what is
there and put:

```python
import sys
path = '/home/<you>/VNNLIB-Solver-Database'
if path not in sys.path:
    sys.path.insert(0, path)

from api.app import app as application
```

Note it imports `app`; it never calls `app.run()`. That call lives under
`if __name__ == "__main__"` and would crash the site if it ran on import.

**4. Reload.** Done — `https://<you>.pythonanywhere.com/health`.

### Serving the demo data while the real database is still empty

`data/solvers.json` holds nothing until a collection has run on `main`, so
until then point the deployment at the fixture by adding one line to the WSGI
file, after the import:

```python
from api.app import app as application
import api.app
api.app.DATABASE = api.app.DEMO_DATABASE   # remove once main has real data
```

`/health` and `/` then report `"source": "demo"`, so whoever builds against
this knows they are looking at fixture data rather than collected data. Delete
the line and reload once the real database has content.

### Updating the data

```bash
cd ~/VNNLIB-Solver-Database && git pull
```

That is the whole update. **No reload needed for data changes**: the process
re-reads the file whenever its mtime changes, so the next request serves the
new database. Reload only after changing code.

To automate it, Tasks tab → a daily scheduled task running the line above.
Free accounts get one, which is plenty for a database that changes when a
solver is submitted.

Two things about the free tier: the web app expires every three months until
you click the button on the Web tab, and outbound HTTP from your code is
restricted to their whitelist — irrelevant here, since this API makes no
outbound requests.

## Anywhere else

Any WSGI host imports `api.app:app` the same way PythonAnywhere does; the
`app.run()` at the bottom is only for running it locally. Paths are resolved
relative to `api/app.py`, not the working directory, so it does not matter
where the server is started from.

Worth knowing before paying for hosting: because the database *is* a static
file, `raw.githubusercontent.com/<you>/VNNLIB-Solver-Database/main/data/solvers.json`
already serves the same data over HTTP for free, with nothing to operate.
This API exists for the filtering, not for the file.

## Tests

```bash
python3 tests/unit/api.py
```

19 checks against Flask's test client — no server, no port, no network.
