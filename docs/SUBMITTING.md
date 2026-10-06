# Submitting a solver

## Before you start: enable the hook

Run this once in your clone, before your first commit:

```bash
git config core.hooksPath .githooks
```

It marks every staged `install.sh` executable as you commit. Git records that bit
itself, separately from your filesystem, so a file authored or copied on Windows
is committed as mode `100644` however `ls -l` looks, and the runner then fails
with "Permission denied" after your pull request is already open.

Without the hook you have to set the bit by hand, as shown under
[install.sh](#installsh), and check it before every push.

## What to submit

Open a pull request adding one directory per release:

```
solvers/<id>/<version>/
    install.sh
    solver.toml
```

`<id>` is lowercase letters, digits and hyphens, and does not change once
accepted. `<version>` is the release you are registering.

---

## install.sh

A bash script that installs your solver, run on a fresh Ubuntu machine.

```bash
#!/usr/bin/env bash
set -euo pipefail

pip install --quiet mysolver==1.2.0
```

**Requirements**

- First line exactly `#!/usr/bin/env bash`
- Executable bit set
- LF line endings, which `.gitattributes` handles for you
- Mentions `<version>` somewhere in its text
- Finishes within 30 minutes
- Leaves an executable named exactly `<id>` on `PATH`

**Available to the script**

- An empty Python virtual environment, already on `PATH`
- `$SOLVER_BIN_DIR`, where that environment puts executables
- Network access and `sudo`

**Setting the executable bit**

The hook above does this for you. To check it, or to set it by hand:

```bash
git ls-files -s solvers/<id>/<version>/install.sh   # want 100755, not 100644
git update-index --chmod=+x solvers/<id>/<version>/install.sh
```

`ls -l` does not answer this question; only `git ls-files -s` does.

---

## solver.toml

```toml
name    = "MySolver"
url     = "https://github.com/example/mysolver"
license = "MIT"
contact = "you@example.edu"
```

| Field | Required | Value |
|---|---|---|
| `name` | no | Display name. Defaults to what `<solver> --name` reports |
| `url` | yes | Repository, project page or documentation |
| `license` | no | SPDX identifier |
| `contact` | no | Who to ask when collection fails |
| `withdrawn` | no | Leave it out. Absent means `false`. Set it only to [retire](#retiring-a-release) the release |

---

## Your solver must answer these 13 commands

```
<solver> --name
<solver> --version

<solver> supports --onnx-opset-versions
<solver> supports --onnx-element-types
<solver> supports --onnx-operators
<solver> supports --vnnlib-versions
<solver> supports --hidden-node-theories
<solver> supports --multiple-input-output-theories
<solver> supports --multiple-network-theories
<solver> supports --multiple-node-comparison-theories
<solver> supports --arithmetic-complexity-theories
<solver> supports --optimised-disjunctive-reasoning
<solver> supports --serialise-assignments
```

All eleven `supports` queries must succeed and return permitted values.
`--version` must report the same version as the directory name.

See [SCHEMA.md](SCHEMA.md) for the permitted values of each.

---

## After you open the pull request

1. Static checks run in seconds. If they fail, push a fix.
2. Your solver is installed and its capabilities posted as a comment.
3. A maintainer reviews and merges.
4. The capabilities are collected again on `main` and committed.

**If the install fails** (non-zero exit, over 30 minutes, or no `<id>` on
`PATH`) **or a query returns non-conforming format**, the error appears in the
pull request comment and nothing enters the database.

A failure on `main` also sets `withdrawn = true` in your `solver.toml`. To
resume after fixing: delete that line, or set it to `false`, in the same pull
request as the fix. A fixed `install.sh` alone is not enough.

---

## Updating a solver

Add a new directory for the new version. Do not edit existing ones.

To correct a release already recorded, edit that version's `install.sh`. The
next collection replaces the record rather than adding a duplicate.

---

## Retiring one release

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

## Retiring every release of a solver

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

---

## Deleting a submission

```bash
git rm -r solvers/<id>              # every release
git rm -r solvers/<id>/<version>/   # or one release
```

Open a pull request. The next collection drops the records.

Retiring is usually the better choice: it also removes the records, but keeps
the install script so the record can be reproduced later.
