# Submitting a solver

This solver database uses the standard VNN-LIB command line format to extract information from the solver.
Therefore to add a solver to the database, all you need to do is to upload an installation script to this repository.

## Step 1. Clone the repository and setup commit hooks

Clone this repository onto your local computer.

Run the following command once:
```bash
git config core.hooksPath .githooks
```

This enables some simple checks such as you have marked your install scripts as executable.

## Step 2. Create a PR with an installation script

Open a pull request that adds a directory with the following structure:

```
solvers/<id>/<version>/
    install.sh
    solver.toml
```

where:

- `<id>` is the name of your solver and consists of lowercase letters, digits and hyphens, and does not change once accepted. 

- `<version>` is the release of your solver that you are registering.

### Contents of install.sh

This file should contain a bash script that installs your solver when run on a fresh Ubuntu machine. For example:

```bash
#!/usr/bin/env bash
set -euo pipefail

pip install --quiet mysolver==1.2.0
```

**Requirements**

- The first line of the script must be `#!/usr/bin/env bash`.
- It must mention `<version>` somewhere in its text.
- It must not take longer than 30 minutes to run.
- It must leave an executable named `<id>` available on the `PATH` variable.

**Available to the script**

- An empty Python virtual environment, already on `PATH`
- `$SOLVER_BIN_DIR`, where that environment puts executables
- Network access and `sudo`

**Setting the executable bit**

The script must be marked as executable. To do this run the following command:

```bash
git update-index --chmod=+x solvers/<id>/<version>/install.sh
```

### solver.toml

The `.toml` file provides meta-data about your solver that cannot be obtained via the VNN-LIB command line format:

| Field | Required | Value |
|---|---|---|
| `url` | yes | Repository, project page or documentation |
| `license` | no | SPDX identifier |
| `contact` | no | Who to ask when collection fails |
| `withdrawn` | no | Leave it out. Absent means `false`. Set it only to [retire](#retiring-a-release) the release |

For example, its contents could be as follows:
```toml
url     = "https://github.com/example/mysolver"
license = "MIT"
contact = "you@example.edu"
```

## Step 3. After you open the pull request

1. Static checks run in seconds. If they fail, push a fix.
2. Your solver is installed and its capabilities posted as a comment.
3. A maintainer of the database will review and merge your PR.
4. The capabilities are collected again on `main` and committed and the database and website will automatically update.

**If the install fails** (non-zero exit, over 30 minutes, or no `<id>` on
`PATH`) **or a query returns non-conforming format**, the error appears in the pull request comment and nothing enters the database.

A failure on `main` also sets `withdrawn = true` in your `solver.toml`. To
resume after fixing: delete that line, or set it to `false`, in the same pull
request as the fix. A fixed `install.sh` alone is not enough.

# Updating a solver

Add a new directory for the new version. Do not edit existing ones.

To correct a release already recorded, edit that version's `install.sh`. The
next collection replaces the record rather than adding a duplicate.

**Collecting a release again without changing it.** 

Collection runs on the
submissions a pull request touches, so to have a release re-installed and
re-queried, open a pull request that changes something in its directory. A
comment line in `install.sh` is enough:

```bash
# re-collect: upstream wheel rebuilt 2026-10-06
```

Worth doing when your solver's answers changed without its version changing, or
when a dependency it installs was republished.

# Retiring a release

Add this to the `solver.toml` already in that version's directory:

```toml
withdrawn = true
```

Lowercase `true`. If the file already has a `withdrawn` line, change that line
rather than adding a second one.

Only a literal `true` retires. `True`, `"true"` and `1` are rejected as errors,
and a `solver.toml` that cannot be parsed leaves the release on offer rather than
retiring it, so a typo fails the checks instead of quietly removing a working
solver.

---

# Retiring every release of a solver

**Create a new `solver.toml` next to the version directories.** This file does
not exist yet; your submission only has one inside each version directory. Add
it, containing nothing but the flag:

```
solvers/<id>/
    solver.toml          <- create this, with: withdrawn = true
    1.0.0/
        install.sh
        solver.toml        
    1.1.0/
        install.sh
        solver.toml
```

```toml
withdrawn = true
```

One line is enough. This file is not a submission, so it doesn't read `name` or
`url`, and you do not have to repeat the flag in each version.

The records leave the database; your submission stays in the repository. To bring
it back, delete the file, or the line, and let the next collection run.

A retired release is not validated and not installed, so a broken `install.sh`
does not block retiring it.

# Deleting a submission

```bash
git rm -r solvers/<id>              # every release
git rm -r solvers/<id>/<version>/   # or one release
```

Open a pull request. The next collection drops the records.

Retiring is usually the better choice: it also removes the records, but keeps
the install script so the record can be reproduced later.
