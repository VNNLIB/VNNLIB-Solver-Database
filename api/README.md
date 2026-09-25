# The HTTP API

Read-only. Serves `data/solvers.json` and answers the reverse question a
solver's `supports` command cannot: *given what I need, which solvers can do
it?*

```bash
pip install -r api/requirements.txt

python3 api/app.py                    # data/solvers.json, the real database
python3 api/app.py --dev              # tests/fixtures/solvers.demo.json
python3 api/app.py --database PATH    # anything else
python3 api/app.py --port 8080
```

It prints which file it is serving at startup, because serving the demo
fixture while believing it is the real database is the one mistake `--dev`
makes easy. A WSGI host imports this module rather than running it, so there
is no command line there, so `SOLVERS_JSON` does the same job.

## Endpoints

| | |
|---|---|
| `GET /` | schema version, when the data was generated, what you can filter on |
| `GET /health` | liveness, and whether the database file is present |
| `GET /solvers` | everything, including releases that failed to install |
| `GET /solvers/<id>` | one solver, 404 if unknown |
| `GET /search?...` | filter; returns solvers with only their matching releases, grouped into version ranges |

Every response carries `Access-Control-Allow-Origin: *`, so a page on another
origin, the Stage 3 search page or anyone's script, can read it. The data
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
`element_types`, not none. Section 5.4.1 says so, and reading the empty list
backwards would silently exclude the solvers that support the most. So
`Relu:float64` matches a solver that printed a bare `Relu` and lists `float64`
among its element types.

Both halves of this are real. The standard's own example prints types:

```
checkNN supports --onnx-operators
Conv float64 float32
Relu float64 float32
```

while vibecheck prints 51 bare names, restricting nothing.

**Ranges take a single value.** `onnx_opset` and `vnnlib_versions` are stored
as inclusive `[min, max]` pairs, so `?onnx_opset=16` asks "does 16 fall in
your range".

## Sorting, paging and the name

`/search` also takes four parameters that change how the answer is presented
rather than which solvers it contains:

| | |
|---|---|
| `name` | substring of the display name or the id, case-insensitive |
| `sort` | `name-asc`, `name-desc`, `version-asc`, `version-desc`, `date-asc`, `date-desc`. Default `date-desc` |
| `limit` | page size. Default 10, capped at 200 |
| `offset` | how many results to skip |

```
/search?arithmetic=POLY&sort=name-asc&limit=10&offset=20
```

The response carries `total`, the whole result set, alongside `solvers`, which
is the page. A pager cannot say "1 to 10 of 34" from the ten it was given.

**The three travel together on purpose.** Sorting or filtering a page in the
browser sorts or filters that page only, which looks right until the reader
notices the top result is missing because it was on page two, and a total
counted from one page is not a total. Whoever slices has to be whoever orders
and filters, so all of it is here.

That is also why `name` is here despite not being a capability. It has no
`vnnfilter` flag and is not part of the command the page displays; it is a
parameter of the request and nothing more.

An unknown `sort` is a 400, like an unknown filter: quietly substituting the
default would answer a different question and look like it had worked. A `limit`
or `offset` that is not a number falls back to the default instead, since those
are a caller's arithmetic rather than a name they might have misspelled.

## /vocabulary

```
GET /vocabulary
{
  "operators": { "Conv": ["float32", "float64"], "MatMul": ["real"], ... },
  "element_types": ["bfloat16", "float16", "float32", ...]
}
```

Every element type any solver reports, and every operator mapped to the types it
can usefully be asked for. The search page builds its two pickers from this
rather than from hard-coded lists that would drift as solvers are added.

**The types beside an operator are not just the ones printed next to it.**
Section 5.4.1 says an operator listed with no types supports *every* type that
solver reports, so a solver printing a bare `Relu` alongside `real` and
`float32` does support `Relu` at both. The union is therefore the explicit lists
plus, for any solver that listed the operator bare, that solver's whole
`element_types`. Reading the empty list as "no types" would offer nothing for
exactly the operators that are supported most widely.

It exists because of paging. The page used to read those lists off the first
search response; a response is now ten solvers, so the picker would offer
whatever those ten happened to support and silently omit everything else.
Working out the real answer means reading every release in the database, which
is the one thing the browser does not have.

## What a search result carries

Each solver in a `/search` response has its `versions` narrowed to the releases
that matched, and an extra `matches` object describing them as a whole:

```json
{
  "id": "testsolver11",
  "name": "TestSolver Eleven",
  "versions": [ ... only the matching records ... ],
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

This exists so a consumer can show one row per solver instead of one per
release. It is computed here rather than in the browser for a reason that is
not obvious: **whether two matching releases are consecutive depends on the
releases between them, and a caller never receives those.** Given only
`["1.0.0", "1.1.0", "2.1.0"]`, nothing tells you that a 1.2.0 and a 2.0.0 exist
and did not match. A page that drew "1.0.0 to 2.1.0" from that would be
claiming a measurement it does not have.

`ranges` is therefore a list of **consecutive runs**, not one span. Two
releases are consecutive when they are adjacent in the solver's `versions`
array, which SCHEMA.md makes a sorted list, so no version string is ever
parsed here: "does 1.10.0 come after 1.9.0" is a question the build already
answered, and answering it a second time with a different rule is how two
orderings end up disagreeing.

A run of one has `from` equal to `to`, so a single-release solver needs no
special case. `latest` is the newest **matching** release, which is what a row
should sort and date itself on, and `matched` / `total` say how much of the
solver qualified.

**Releases that never installed never match**, not even an empty query. Search
answers "what can do this", and nothing was measured about them: they are
still visible through `/solvers`.

## Hosting it on PythonAnywhere

Free tier, no card, and `.github.com` / `.githubusercontent.com` are on their
whitelist, so `git pull` works.

**1. Get the code there.** Bash console:

```bash
git clone https://github.com/VNNLIB/VNNLIB-Solver-Database.git
mkvirtualenv --python=/usr/bin/python3.12 solverdb
pip install flask
```

3.12, like the rest of the project. The API itself would run on anything from
3.9 up, since it only imports `json`, `pathlib`, `argparse` and Flask, but keeping
one version everywhere means one thing to remember. The stricter requirement
elsewhere belongs to `register.py`, which installs solvers; nothing is
installed here.

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

**4. Reload.** Done: `https://<you>.pythonanywhere.com/health`.

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

By hand:

```bash
cd ~/VNNLIB-Solver-Database && git pull
```

**No reload needed for data changes**: the process re-reads the file whenever
its mtime changes, so the next request serves the new database. Reload only
after changing code.

### Updating it automatically

`collect.yml` pushes the database straight to PythonAnywhere after a
collection, using their Files API. Set two repository secrets (Settings →
Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `PA_USERNAME` | your PythonAnywhere username |
| `PA_API_TOKEN` | Account page → API Token tab |

Add a repository *variable* `PA_HOST` = `eu.pythonanywhere.com` if your
account is on their EU system. Without the secrets the step prints
`no PythonAnywhere secrets set, skipping publish` and the workflow carries on.

It uploads to `/home/<you>/solvers.json`, **outside** the git clone on
purpose, so the checkout stays clean and `git pull` there never conflicts with
a file the API overwrote. Point the web app at it in the WSGI file:

```python
from api.app import app as application
import api.app, pathlib
api.app.DATABASE = pathlib.Path('/home/<you>/solvers.json')
```

Nothing needs reloading afterwards: a new upload changes the file's mtime, and
the next request re-reads it.

This lives inside `collect.yml` rather than in a workflow watching `data/**`,
because a push made with `GITHUB_TOKEN` deliberately does not trigger further
workflows, and a separate one would simply never run.

Two things about the free tier: the web app expires every three months until
you click the button on the Web tab, and outbound HTTP from your code is
restricted to their whitelist, which is irrelevant here, since this API makes no
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

26 checks against Flask's test client: no server, no port, no network.
