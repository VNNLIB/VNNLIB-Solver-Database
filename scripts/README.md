# The collection pipeline

Four modules. One installs, one asks, one records, one holds the constants
they all have to agree on.

```
register.py  ──imports──>  collect.py  ──> the solver binary
     │                          │
     │ one Solver entry         └── schema.py
     ▼
results.jsonl  ──>  build.py  ──>  data/solvers.json
```

Only `register.py` and `build.py` are commands. `collect.py` is a library —
it runs on every solver, but always through `register.py`, never as its own
process.

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
| `schema.py` | library | `SCHEMA_VERSION`, `now_iso()` — the things all three must spell identically |

## Things that are easy to get wrong

**The venv inherits the interpreter running `register.py`.** `venv.EnvBuilder`
clones the current Python, so `python3 register.py` builds a 3.10 venv even
with 3.12 installed. Launch it with the version you want:
`python3.12 scripts/register.py ...`.

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

- **The two booleans are unparsed.** `--optimised-disjunctive-reasoning` and
  `--serialise-assignments` have never been seen from a running solver, so
  `parse_boolean` returns raw text rather than guessing whether `true`,
  `True` or `yes` is the spelling. They come out as the string `"true"`,
  not `true`.
- **Version ordering is natural sort, not semver.** `1.0.0-rc1` sorts after
  `1.0.0`. Nothing says these strings are semver, so it is not assumed.

## Testing

See [tests/README.md](../tests/README.md).
