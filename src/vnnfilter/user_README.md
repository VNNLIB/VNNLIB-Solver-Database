# vnnfilter — developer notes

This package is what `README.md` at the repo root calls "the Python
package." It exposes:

- a `vnnfilter` CLI (`src/vnnfilter/cli.py`)
- a small Python API (`vnnfilter.search`, `vnnfilter.Query`, `vnnfilter.load_database`)

## Data flow

- `data/solvers.json` at the repo root is the database the collection
  pipeline writes. It is the source of truth.
- `src/vnnfilter/_data/solvers.json` is a bundled copy, so an installed
  package works offline. Run `python scripts/sync_package_data.py` to
  refresh it before cutting a release; CI should run
  `python scripts/sync_package_data.py --check` to catch a stale copy.
- At runtime, `vnnfilter.load_database()` reads (in order) an explicit
  path, the `VNNFILTER_DATA_FILE` environment variable, then the bundled
  copy. Point it at a local checkout's `data/solvers.json` while
  developing so you don't have to keep re-syncing.

## Working on it

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
```

`tests/` runs against `data/solvers.sample.json`, the hand-written fixture,
not the real (currently empty) database — see its three solvers
(`vibecheck`: `ok`, `brokennn`: `incomplete`, `deadsolver`: `install_failed`)
for the edge cases the query logic has to handle.

## Design notes

See the module docstrings in `vnnfilter/data.py` and `vnnfilter/query.py`
for the matching rules; they follow `docs/SCHEMA.md` directly (theory
fields match against `satisfies`, not raw `capabilities`; an absent or
`null` field never matches; every criterion is optional and requires-all
rather than requires-any except each single-value theory flag).
