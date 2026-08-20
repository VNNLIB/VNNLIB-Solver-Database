# Submitting a solver

Open a pull request adding one directory per release:

```
solvers/<id>/<version>/
    install.sh
    solver.toml
```

`<id>` is a short lowercase name, letters, digits and hyphens. It becomes part
of URLs, so it does not change once accepted. `<version>` is the release you are
registering.

---

## install.sh

A shell script that installs your solver. It runs on a fresh Ubuntu machine that
is destroyed immediately afterwards.

It is executed directly, as `./install.sh`, not passed to an interpreter
explicitly. That means the first line must be `#!/usr/bin/env bash`, the file
must be executable, and it must be valid bash. This is also why line endings
matter, see below.

```bash
#!/usr/bin/env bash
set -euo pipefail

pip install --quiet mysolver==1.2.0
```

**What the environment gives you**

- an empty Python virtual environment, already on `PATH`, so a plain
  `pip install` lands inside it and affects nothing else
- `$SOLVER_BIN_DIR`, the directory that environment puts executables in, for
  scripts that install by writing an executable directly
- network access, and `sudo` for system packages

**What you must leave behind**

When the script finishes, an executable named exactly `<id>` must be on `PATH`.
That is the whole contract. Anything else is up to you.

**It must install the version the directory names.**

The script has to mention `<version>` somewhere — normally as the pin itself,
`pip install mysolver==1.2.0`. A script in `1.2.0/` that installs `1.1.0`, or
that leaves the version unpinned and installs whatever is newest, is rejected
before anything is installed and you will be asked to push a fix.

This is checked two ways. Before installing, the text of your script must
contain the version string. After installing, `<solver> --version` is compared
against the directory name. The directory always wins: it decides which
release the record describes, so a script that installs something else would
record one release's capabilities under another's name.

If your script installs from a git tag or builds from source, name the version
in it anyway — the tag, the checkout, or a comment.

**What counts as failure**

- the script exits non-zero
- it runs longer than 30 minutes
- it finishes but leaves no executable named `<id>`

Any of those is recorded as `install_failed`, with the error, and the solver
appears in the database marked as such rather than being silently dropped.

Failing the checks above is different: nothing is installed, nothing is
recorded, and the pull request cannot be merged until it is fixed.

**Line endings must be LF.** A script saved with Windows line endings fails on
the runner with a confusing `bad interpreter` error. The `.gitattributes` in
this repository enforces this, so it should happen automatically.

**The executable bit is recorded by git, not by your filesystem.** If you
author on Windows, the file is committed as non-executable even when it looks
executable locally, and the collection fails on the runner. `.gitattributes`
cannot set this. Check and fix with:

```bash
git ls-files -s solvers/<id>/<version>/install.sh   # want 100755, not 100644
git update-index --chmod=+x solvers/<id>/<version>/install.sh
```

Running `git config core.hooksPath .githooks` once in your clone does it
automatically on every commit.

---

## solver.toml

```toml
name    = "MySolver"
repo    = "https://github.com/example/mysolver"
license = "MIT"
contact = "you@example.edu"
```

| Field | Required | Notes |
|---|---|---|
| `name` | no | Display name. Defaults to what `<solver> --name` reports |
| `repo` | yes | Canonical source URL. Used to detect the same solver submitted twice |
| `license` | no | SPDX identifier |
| `contact` | no | Who to ask when collection fails |

---

## What happens next

1. A workflow checks your submission without installing anything: layout, line
   endings, shebang, executable bit, `solver.toml`, and that the install script
   names the version its directory claims. Anything wrong here fails in seconds
   and needs a fix pushed before the rest runs.
2. A workflow installs your solver and posts its capabilities as a comment on
   your pull request. 
3. A maintainer reviews the install script and merges.
4. A second workflow installs it again on the main branch, records the
   capabilities, and commits them.

The solver is deleted after each collection. Nothing about it is kept except
the capability record.

---

## What is collected

Two global options and the eleven `supports` capabilities that Section 5.4 of
the standard makes mandatory:

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

`verify` is never called. Your solver is never asked to solve anything.

If a query fails or returns a value outside the permitted set, that one field is
recorded as unknown and the rest of your record still works. You are not
excluded from the database for one bad flag.

---

## Updating

Add a new directory for the new version. Do not edit the old one. Every version
is kept.
To correct a mistake in a release already recorded, edit that version's
`install.sh`. Re-collection overwrites the existing record rather than creating
a duplicate.
