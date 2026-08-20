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
`collect.py` and `schema.py` are libraries — `collect.py` runs on every solver,
but always through `register.py`, never as its own process.

## What happens to one submission

Given `solvers/<id>/<version>/`:

0. **`validate.py`** checks the files without installing anything. A submission
   whose `install.sh` does not name its directory's version is rejected here,
   in milliseconds, rather than recording one release's capabilities under
   another release's name half an hour later.
1. **`register.py`** creates an empty virtualenv and hands its `bin/` to the
   submitted script as `$SOLVER_BIN_DIR`.
2. **`install.sh`** — the submitter's code, not ours — installs the solver and
   must leave an executable named exactly `<id>` on `PATH`.
3. **`register.py`** looks for that executable. If the script failed, timed
   out, or left nothing behind, the record is `install_failed` and step 4
   never runs: there is nothing to query.
4. **`collect.py`** runs the 13 commands (`--name`, `--version`, and the
   eleven `supports` flags) against the binary and builds the version record.
5. **`register.py`** deletes the temp directory — venv and solver with it.
6. **`build.py`** merges the record into `data/solvers.json`.

Only the record survives. The solver is thrown away every time.

## The division of labour

`register.py` owns **how** a solver gets onto the machine: venvs, subprocesses,
timeouts, cleanup. `collect.py` owns **what** to ask once it is there: it never
imports `venv` or `tempfile`, and receives the binary as a path it can run.

That split is what makes the parsers testable. Every function in `collect.py`
below `run_query` is a pure function over a string, so `tests/unit/collect.py`
exercises all of them with hand-typed solver output — no install, no venv, no
network, milliseconds.

## The modules

| File | Entry point | Does |
|---|---|---|
| `validate.py` | `validate.py <dir>...` | static checks on a submission, before anything is installed. Non-zero exit blocks the PR. Also owns reading `solver.toml` |
| `register.py` | `register.py <dir> [--timeout N]` | install, collect, tear down. One line of JSON on stdout, status on stderr |
| `collect.py` | library | run the 13 queries, parse them into SCHEMA.md's shapes |
| `build.py` | `build.py <results.jsonl> [--database P] [--dry-run]` | merge records into the database |
| `report.py` | `report.py <results.jsonl>` | render records as markdown, for a PR comment or job summary |
| `schema.py` | library | `SCHEMA_VERSION`, `now_iso()` — the things the others must spell identically |

## Things that are easy to get wrong

**The venv inherits the interpreter running `register.py`.** `venv.EnvBuilder`
clones the current Python, so `python3 register.py` on Ubuntu 22.04 builds a
3.10 venv even with 3.12 installed. `register.py` refuses below
`schema.MINIMUM_PYTHON` rather than letting that surface minutes later as an
unresolvable pip pin. Launch it as `python3.12 scripts/register.py ...`.

The project is on **3.12 everywhere** — `.python-version`, both workflows, and
`schema.PYTHON_VERSION`.

**The directory name is the authority on version.** `--version` is
cross-checked against it, never substituted for it. A solver reporting
something else gets an error in the record and keeps the directory's version.

**`build.py` merges, it does not regenerate.** A solver absent from
`results.jsonl` is left alone; re-collecting a version replaces that version
only; versions are never removed. If nothing changed, the file is not
rewritten at all.

**Exit codes are about the run, not the solver.** `register.py` exits 0 even
for `install_failed` — a recorded failure is data, and a non-zero exit would
abort the workflow's loop over the remaining solvers.

## Known gaps

- **Version ordering is natural sort, not semver.** `1.0.0-rc1` sorts after
  `1.0.0`. Nothing says these strings are semver, so it is not assumed.
- **`schema_version` is still `1.0`** although `operators` changed from raw
  lines to an object and the two booleans from strings to real booleans. The
  argument for not bumping it: SCHEMA.md described both shapes all along, so
  the code was wrong rather than the contract. Worth raising with the client.
- **A duplicate `repo` is a warning, not a failure.** `build.py` prints when
  two ids claim the same repository, because deciding which one is real needs
  a human.

## Testing

See [tests/README.md](../tests/README.md).
