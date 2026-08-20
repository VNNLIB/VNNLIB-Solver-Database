# Running the tests

Everything here needs Python 3.12 and, apart from the unit tests, bash.
Nothing writes to `data/solvers.json`.

## Unit tests — `tests/unit/`

Pure functions over strings, and the API through Flask's test client. No
solver, no venv, no network, no port. Milliseconds.

```bash
python3 tests/unit/collect.py      # the parsers and the closure
python3 tests/unit/validate.py     # the submission checks
python3 tests/unit/api.py          # the endpoints and the filters
```

Each file is named after the module it tests, so it is loaded by path rather
than imported — `tests/unit/collect.py` cannot `import collect` without
importing itself.

## Integration test — `tests/integration/`

Real venvs, real `install.sh`, real binaries. Skips itself on Windows, with
no bash, or with no `ensurepip`.

```bash
python3 tests/integration/pipeline.py          # fakes only, ~8s, offline
python3 tests/integration/pipeline.py --slow   # also the real solvers
```

`--slow` reaches PyPI and pulls torch, so it can fail for reasons that have
nothing to do with this repo. Keep it out of the default run.

## Fixtures — `tests/fixtures/`

Fake solvers that install in milliseconds, one per outcome the pipeline has
to handle. Each is a real `solvers/<id>/<version>/` layout, so they work
with `register.py` unchanged.

| Fixture | Status it produces | Why |
|---|---|---|
| `testsolver/1.0.0` | `ok` | answers all 13 commands, with `* note` suffixes |
| `brokensolver/0.9.0` | `incomplete` | five flags broken five different ways |
| `deadsolver/1.0.0` | `install_failed` | script exits non-zero |
| `ghostsolver/1.0.0` | `install_failed` | exits 0, leaves no matching executable |
| `vibecheck/1.1.0` | (real solver) | `--slow` only; pulls torch |

## Driving the pipeline by hand

One solver:

```bash
python3 scripts/register.py tests/fixtures/testsolver/1.0.0
```

One line of JSON on stdout, the status on stderr. Exit code is 0 even for
`install_failed` — a recorded failure is not a broken run.

All of them, then merged into a database, which is what the workflow does:

```bash
for d in tests/fixtures/*/*/; do python3 scripts/register.py "$d"; done > /tmp/results.jsonl
python3 scripts/build.py /tmp/results.jsonl --database /tmp/db.json
```

Run `build.py` twice with the same input: the second run must report
`no changes` and leave the file untouched. That is the property proving
re-collection overwrites rather than duplicates.

`build.py --dry-run` reports what would change without writing.

## Just the collector, no install

`collect.py` only needs a binary that already exists:

```bash
mkdir -p /tmp/solverbin
SOLVER_BIN_DIR=/tmp/solverbin tests/fixtures/testsolver/1.0.0/install.sh
cd scripts
PATH=/tmp/solverbin:$PATH python3 -c "import collect, json; \
    print(json.dumps(collect.collect('testsolver', 'testsolver', '1.0.0'), indent=2))"
```

## Python version

**3.12 everywhere** — the workflows, the machine that collects, and the API
host. It is recorded in `.python-version` and in `schema.PYTHON_VERSION`.

`register.py` builds each solver's venv by cloning the interpreter that runs
it, so `python3 scripts/register.py` on Ubuntu 22.04 would build a 3.10 venv
even with 3.12 installed. It now refuses rather than letting that surface
minutes later as an unresolvable pip pin:

```
register.py needs Python 3.11+ and is running 3.10.
```

Launch it as `python3.12 scripts/register.py`.

Why not older: vibecheck pins `onnxruntime==1.26.0`, which requires 3.11+ and
ships no wheel for 3.13. Ubuntu 22.04 carries neither 3.12 nor a stable 3.11,
so it needs the deadsnakes PPA:

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.12 python3.12-venv
```

`python3.12-venv` is not optional — without it venv creation fails with an
`ensurepip is not available` error.

The unit tests and the API run on anything from 3.9 up — only `register.py`
enforces a minimum, because only it installs solvers. Use 3.12 anyway, so
what you run locally is what CI runs.

## Windows

The unit tests, `build.py`, `report.py` and the API all run under `cmd` with
`python`. `register.py` and the integration test do not: they execute
`./install.sh`, and Windows Python cannot run a shebang script through
`subprocess`. Use WSL for those; the integration test skips itself with an
explanation rather than failing.

One trap: `validate.py` runs on Windows but its executable-bit check is
meaningless there, because `os.access(..., X_OK)` reports every existing file
as executable. Only `git ls-files -s` tells the truth:

```bash
git ls-files -s solvers/*/*/install.sh    # want 100755, not 100644
```

Enabling the repository's hook once per clone fixes it at commit time:

```bash
git config core.hooksPath .githooks
```
