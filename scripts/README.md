# The collection pipeline

Six files. One checks, one installs, one asks, one records, one reports, and
one holds the constants the rest have to agree on.

```
validate.py  ──>  register.py  ──imports──>  collect.py  ──> the solver binary
                       │                          │
                       │ one Solver entry         └── schema.py
                       ▼
                 results.jsonl  ──>  build.py   ──>  data/solvers.json
                       │
                       └────────>  report.py    ──>  markdown for a PR comment
```

`validate.py`, `register.py`, `build.py` and `report.py` are commands.
`collect.py` and `schema.py` are libraries. `collect.py` runs on every solver,
but always through `register.py`, never as its own process.

## What happens to one submission

Given `solvers/<id>/<version>/`:

0. **`validate.py`** checks the files without installing anything. A submission
   whose `install.sh` does not name its directory's version is rejected here,
   in milliseconds, rather than recording one release's capabilities under
   another release's name half an hour later.
1. **`register.py`** creates an empty virtualenv and hands its `bin/` to the
   submitted script as `$SOLVER_BIN_DIR`.
2. **`install.sh`**, the submitter's code and not ours, installs the solver and
   must leave an executable named exactly `<id>` on `PATH`.
3. **`register.py`** looks for that executable. If the script failed, timed
   out, or left nothing behind, the record is `install_failed` and step 4
   never runs: there is nothing to query.
4. **`collect.py`** runs the 13 commands (`--name`, `--version`, and the
   eleven `supports` flags) against the binary and builds the version record.
5. **`register.py`** deletes the temp directory, venv and solver with it.
6. **`build.py`** merges the record into `data/solvers.json`.

Only the record survives. The solver is dispose.

## The division of labour

`register.py` owns **how** a solver gets onto the machine: venvs, subprocesses,
timeouts, cleanup. `collect.py` owns **what** to ask once it is there: it never
imports `venv` or `tempfile`, and receives the binary as a path it can run.

That split is what makes the parsers testable. Every function in `collect.py`
below `run_query` is a pure function over a string, so `tests/unit/collect.py`
exercises all of them with hand-typed solver output: no install, no venv, no
network, milliseconds.

## The modules

| File | Entry point | Does |
|---|---|---|
| `validate.py` | `validate.py <dir>... [--list-offered]` | static checks on a submission, before anything is installed. Non-zero exit blocks the PR. Also owns reading `solver.toml` and deciding what is still on offer |
| `register.py` | `register.py <dir> [--timeout N]` | install, collect, tear down. One line of JSON on stdout, status on stderr |
| `collect.py` | library | run the 13 queries, parse them into SCHEMA.md's shapes |
| `build.py` | `build.py <results.jsonl> [--database P] [--solvers-dir D] [--retire-failed] [--dry-run]` | merge clean records into the database, drop retired ones, and optionally retire what failed to install |
| `report.py` | `report.py <results.jsonl>` | render records as markdown, for a PR comment or job summary |
| `schema.py` | library | `SCHEMA_VERSION`, `now_iso()`, the things the others must spell identically |

## Known gaps

- **Version ordering is natural sort, not semver.** `1.0.0-rc1` sorts after
  `1.0.0`. Nothing says these strings are semver, so it is not assumed.
- **A duplicate `url` is a warning, not a failure.** `build.py` prints when two
  ids claim the same URL, because deciding which one is real needs a human.

## Testing

See [tests/README.md](../tests/README.md).
