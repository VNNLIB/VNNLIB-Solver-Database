# The collection pipeline

```
validate.py  ──>  register.py  ──imports──>  collect.py  ──> the solver binary
                       │                          │
                       │ one record               └── schema.py
                       ▼
                 results.jsonl  ──>  build.py   ──>  data/solvers.json
                       │
                       └────────>  report.py    ──>  markdown for a PR comment
```

| File | Run as | Does |
|---|---|---|
| `validate.py` | `validate.py <dir>... [--list-offered]` | Static checks on a submission, installing nothing. Non-zero exit if any fail. `--list-offered` prints the submissions that are not retired |
| `register.py` | `register.py <dir> [--timeout N]` | Builds a virtualenv, runs `install.sh` with its `bin/` as `$SOLVER_BIN_DIR`, finds the binary, calls `collect.py`, deletes the lot. One line of JSON on stdout |
| `collect.py` | library | Runs the 13 commands against a binary on `PATH` and parses the output into SCHEMA.md's shapes |
| `build.py` | `build.py <results> [--database P] [--output P] [--solvers-dir D] [--retire-failed] [--dry-run]` | Merges records into `data/solvers.json`, dropping releases that are retired or did not collect cleanly. `--retire-failed` writes `withdrawn = true` into the `solver.toml` of anything that failed to install |
| `report.py` | `report.py <results>` | Renders records as markdown for a pull request comment |
| `schema.py` | library | `SCHEMA_VERSION`, `PYTHON_VERSION`, `now_iso()` and the other constants the rest must spell identically |
| `sync_package_data.py` | `sync_package_data.py [--check]` | Copies `data/solvers.json` into `src/vnnfilter/_data/` |

## One submission, end to end

1. `validate.py` checks the files.
2. `register.py` runs `install.sh`, which must leave an executable named `<id>`
   on `PATH`.
3. If it did not, the record is `install_failed` and step 4 is skipped.
4. `collect.py` runs the 13 commands and builds the version record.
5. `register.py` deletes the temporary directory.
6. `build.py` merges the record into `data/solvers.json`.

## Notes

- Needs Python 3.11+, and 3.12 is what the workflows use.
- Version ordering is natural sort, not semver: `1.0.0-rc1` sorts after `1.0.0`.
- A `url` claimed by two ids is a warning, not a failure.
- `register.py` exits 0 even for `install_failed`, so a loop over several
  submissions is not aborted by one of them.

[SUBMITTING.md](../docs/SUBMITTING.md) for what a submission must contain,
[SCHEMA.md](../docs/SCHEMA.md) for the database fields,
[tests/README.md](../tests/README.md) for the tests.
