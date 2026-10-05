# Running the tests

Python 3.12, and bash for everything except the unit tests. Nothing writes to
`data/solvers.json`.

## Unit: `tests/unit/`

No solver, no venv, no network, no port. Milliseconds.

```bash
python3 tests/unit/collect.py      # the parsers and the closure
python3 tests/unit/validate.py     # the submission checks
python3 tests/unit/build.py        # merging, publishing, retiring
python3 tests/unit/api.py          # the endpoints and the filters
```

Each file is named after the module it tests and is loaded by path, since
`tests/unit/collect.py` cannot `import collect` without importing itself.

## Integration: `tests/integration/`

Real venvs, real `install.sh`, real binaries. Skips itself on Windows, without
bash, or without `ensurepip`.

```bash
python3 tests/integration/pipeline.py          # fakes only, ~8s, offline
python3 tests/integration/pipeline.py --slow   # also the real solver
```

`--slow` reaches PyPI and pulls torch, so keep it out of the default run.

## Fixtures: `tests/fixtures/`

Fake solvers in a real `solvers/<id>/<version>/` layout, so `register.py` takes
them unchanged. One per outcome the pipeline has to handle.

| Fixture | Status | Published | Why |
|---|---|---|---|
| `testsolver/1.0.0` | `ok` | yes | answers all 13 commands, with `* note` suffixes |
| `brokensolver/0.9.0` | `incomplete` | no | five flags broken five different ways |
| `deadsolver/1.0.0` | `install_failed` | no | script exits non-zero |
| `ghostsolver/1.0.0` | `install_failed` | no | exits 0, leaves no matching executable |
| `vibecheck/1.1.0` | real solver | if `ok` | `--slow` only; pulls torch |

`solvers.demo.json` is the fixture database `api/app.py --dev` serves.

## Driving the pipeline by hand

```bash
python3 scripts/register.py tests/fixtures/testsolver/1.0.0
```

One line of JSON on stdout, the status on stderr. Exit code 0 even for
`install_failed`.

All of them, then merged, which is what `collect.yml` does:

```bash
for d in tests/fixtures/*/*/; do python3 scripts/register.py "$d"; done > /tmp/results.jsonl
python3 scripts/build.py /tmp/results.jsonl --database /tmp/db.json
```

Only `testsolver` comes out. Add `--solvers-dir tests/fixtures` to also drop
anything retired, and `--dry-run` to report changes without writing.

Running `build.py` twice on the same input must report `no changes` the second
time: that is the property proving re-collection overwrites rather than
duplicates.

### Just the collector, no install

```bash
mkdir -p /tmp/solverbin
SOLVER_BIN_DIR=/tmp/solverbin tests/fixtures/testsolver/1.0.0/install.sh
cd scripts
PATH=/tmp/solverbin:$PATH python3 -c "import collect, json; \
    print(json.dumps(collect.collect('testsolver', 'testsolver', '1.0.0'), indent=2))"
```

## Python version

3.12, recorded in `.python-version` and `schema.PYTHON_VERSION`. The unit tests
and the API run on 3.9 up; only `register.py` enforces a minimum, and it refuses
below 3.11 rather than failing later on a pip pin.

`register.py` clones the interpreter that runs it into each solver's venv, so
launch it as `python3.12 scripts/register.py`. On Ubuntu 22.04 that needs the
deadsnakes PPA:

```bash
sudo add-apt-repository ppa:deadsnakes/ppa && sudo apt update
sudo apt install python3.12 python3.12-venv
```

`python3.12-venv` is required, or venv creation fails with `ensurepip is not
available`.

## Windows

The unit tests, `build.py`, `report.py` and the API run under `cmd`. `register.py`
and the integration test do not: they execute `./install.sh`, and Windows Python
cannot run a shebang script through `subprocess`. Use WSL.

`validate.py` runs, but its executable-bit check is meaningless there, because
`os.access(..., X_OK)` calls every existing file executable. Only git knows:

```bash
git ls-files -s solvers/*/*/install.sh    # want 100755, not 100644
git config core.hooksPath .githooks       # once per clone, fixes it at commit time
```

## In CI

`.github/workflows/tests.yml` runs the four unit suites and re-validates every
submission in `solvers/`, on every push to `main` and every pull request. It
installs `api/requirements.txt` and nothing else, since the pipeline scripts are
standard library only.

The integration test is deliberately not in it: `--slow` can go red for reasons
unrelated to the change being tested.
