# `_data/`

This folder holds the bundled offline copy of the solver database, shipped inside the
`vnnfilter` package itself.

## `solvers.json`

The last-known-good snapshot of the solver registry, packaged with `vnnfilter` so the
tool still works with no internet connection.

### How it's used

`load_database()` (in `data.py`) tries these sources in order:

1. An explicit path passed by the caller
2. The `VNNFILTER_DATA_FILE` environment variable, if set
3. A live fetch from the hosted API (`DEFAULT_API_URL`)
4. This bundled file, as the last-resort fallback

### How it stays current

Every time step 3 succeeds, `_refresh_bundle()` writes the freshly fetched data back
over this file. So the bundle is a write-through cache: it updates itself whenever a
user has a working connection, and only goes stale for users who are offline for a
long stretch.

### Do not edit by hand

This file is overwritten automatically by `_refresh_bundle()`. Manual edits will be
lost the next time someone with an internet connection runs the package. To update the
canonical data, publish a new version through the live API
(`https://12er90.pythonanywhere.com/solvers`) instead.

### Testing note

Tests that mock the live fetch (e.g. `test_no_args_fetches_live_api`) must also mock
`_refresh_bundle`, otherwise a "successful" mocked fetch will silently overwrite this
file with the mock's contents during `pytest` runs.
