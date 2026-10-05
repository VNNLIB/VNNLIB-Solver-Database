# The collection pipeline

Seven files. Four are commands, three are libraries.

```
validate.py  ──>  register.py  ──imports──>  collect.py  ──> the solver binary
                       │                          │
                       │ one Solver entry         └── schema.py
                       ▼
                 results.jsonl  ──>  build.py   ──>  data/solvers.json
                       │
                       └────────>  report.py    ──>  markdown for a PR comment
```

| File | Run as | Does |
|---|---|---|
| `validate.py` | `validate.py <dir>... [--list-offered]` | Static checks on a submission: `install.sh` has the right shebang, LF line endings, the executable bit, and names its directory's version; `solver.toml` parses and has a `url`. Non-zero exit if any submission fails. `--list-offered` prints the subset that is not retired. Also the module the others import for reading `solver.toml` |
| `register.py` | `register.py <dir> [--timeout N]` | Builds an empty virtualenv, runs the submitted `install.sh` with its `bin/` as `$SOLVER_BIN_DIR`, finds the installed binary, calls `collect.py` against it, then deletes the lot. One line of JSON on stdout, status on stderr. Needs Python 3.11+ |
| `collect.py` | library | Runs the 13 commands (`--name`, `--version`, and the eleven `supports` flags) against a binary already on `PATH` and parses the output into SCHEMA.md's shapes |
| `build.py` | `build.py <results> [--database P] [--output P] [--solvers-dir D] [--retire-failed] [--dry-run]` | Merges records from `results.jsonl` into `data/solvers.json`, drops releases that are retired or did not collect cleanly, and with `--retire-failed` writes `withdrawn = true` into the `solver.toml` of anything that failed to install |
| `report.py` | `report.py <results>` | Renders records as markdown, for a pull request comment or job summary |
| `schema.py` | library | `SCHEMA_VERSION`, `PYTHON_VERSION`, `now_iso()` and the other constants the rest must spell identically |
| `sync_package_data.py` | `sync_package_data.py [--check]` | Copies `data/solvers.json` into `src/vnnfilter/_data/` for a package release |

## One submission, end to end

Given `solvers/<id>/<version>/`:

1. `validate.py` checks the files. Nothing is installed.
2. `register.py` creates a virtualenv and runs `install.sh`, which must leave an
   executable named `<id>` on `PATH`.
3. If that produced nothing, the record is `install_failed` and step 4 is
   skipped.
4. `collect.py` runs the 13 commands and builds the version record.
5. `register.py` deletes the temporary directory.
6. `build.py` merges the record into `data/solvers.json`.

The solver is thrown away. Only the record survives.

## Notes

- Version ordering is natural sort, not semver: `1.0.0-rc1` sorts after `1.0.0`.
- A `url` claimed by two ids is a warning, not a failure.
- `register.py` exits 0 even for `install_failed`, so a loop over several
  solvers is not aborted by one of them.

## Related

[SUBMITTING.md](../docs/SUBMITTING.md) for what a submission must contain,
[SCHEMA.md](../docs/SCHEMA.md) for the database fields,
[tests/README.md](../tests/README.md) for running the tests.
