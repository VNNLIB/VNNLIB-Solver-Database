# Running the tests

Everything here needs Python 3.11+ and, apart from the unit tests, bash.
Nothing writes to `data/solvers.json`.

## Unit tests — `tests/unit/`

Pure functions over strings. No solver, no venv, no network, milliseconds.

```bash
python3 tests/unit/collect.py
```

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

vibecheck pins `onnxruntime==1.26.0`, which needs Python 3.11+ and publishes
no wheel for 3.13. Use 3.12 — it is what vibecheck itself is developed
against. Ubuntu 22.04 needs the deadsnakes PPA to get it.
