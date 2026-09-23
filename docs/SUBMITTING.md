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

The script has to mention `<version>` somewhere, normally as the pin itself,
`pip install mysolver==1.2.0`. A script in `1.2.0/` that installs `1.1.0`, or
that leaves the version unpinned and installs whatever is newest, is rejected
before anything is installed and you will be asked to push a fix.

This is checked two ways. Before installing, the text of your script must
contain the version string. After installing, `<solver> --version` is compared
against the directory name. The directory always wins: it decides which
release the record describes, so a script that installs something else would
record one release's capabilities under another's name.

If your script installs from a git tag or builds from source, name the version
in it anyway: the tag, the checkout, or a comment.

**What counts as failure**

| | What happened |
|---|---|
| The install failed | the script exited non-zero, ran longer than 30 minutes, or left no executable named `<id>` |
| The collection failed | it installed, but one of the eleven queries answered with something unusable |

Both are reported with the error in the comment on your pull request, and
**neither enters the database.** The database advertises what a solver can do,
and a release nobody can install or measure has nothing to advertise.

On the main branch, failing also retires the release: the workflow sets
`withdrawn = true` in its `solver.toml` and commits that, so the pipeline stops
spending half an hour per push to reach a conclusion it already has. Fix the
problem, **set `withdrawn` back to `false` yourself**, and the next collection
picks the release up. It does not resume on its own, because a retired release
is skipped before anything is installed: a fixed `install.sh` alone changes
nothing.

Failing the static checks is different. Nothing is installed at all, and the
pull request cannot be merged until it is fixed.

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
name      = "MySolver"
repo      = "https://github.com/example/mysolver"
license   = "MIT"
contact   = "you@example.edu"
withdrawn = false
```

| Field | Required | Notes |
|---|---|---|
| `name` | no | Display name. Defaults to what `<solver> --name` reports |
| `repo` | yes | Canonical source URL. Used to detect the same solver submitted twice |
| `license` | no | SPDX identifier |
| `contact` | no | Who to ask when collection fails |
| `withdrawn` | yes | `false` on a live release, so that [retiring](#retiring-a-solver) one is a change to a line already there rather than a new key |

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

If a query fails or returns a value outside the permitted set, the comment on
your pull request names the flag and what it printed. All eleven have to work
before the release is published, so one bad flag is worth fixing rather than
ignoring.

---

## Retiring a solver

Submissions are never deleted from this repository. To retire a release, flip
the `withdrawn` line in its `solver.toml` and open a pull request:

```toml
withdrawn = true
```

Lowercase `true`. TOML booleans are not capitalised, so `True` is a syntax
error rather than a value, and the submission is rejected with that message.

Change the line that is already there rather than adding a second one. That is
why the field is required in the first place: a key twice in one TOML file is
an error, not a later value winning, so the file stops being readable and the
retirement does not take effect.

To retire **every** release at once, when the project itself is no longer
maintained rather than one release being superseded, put the same line in a
`solver.toml` one level up, beside the version directories:

```
solvers/<id>/
    solver.toml          <- withdrawn = true retires all of them
    1.0.0/
    1.1.0/
```

Either file saying so is enough; they are two ways to answer the same
question, not two conditions to satisfy.

Your record is then **removed from the database**, so what is published
describes only what can be used today. Your submission stays in the repository,
which is what makes this reversible: setting the flag back to `false` and
letting the next collection run reproduces the record exactly.

A retired release is never installed again, so the usual checks are skipped
for it: your `install.sh` is not validated and not run, which matters because
an old script that has stopped working is often the reason for retiring a
release in the first place.

### Deleting a submission outright

Retiring is what authors do. Deleting is a maintainer action, and it is not the
normal way to take a solver out of the database. Retiring already does that, and
it keeps the install script, so the record can be reproduced later. Deletion
throws that away: the capabilities were measured by installing software that may
no longer exist anywhere, and once the script is gone, nothing in this
repository can produce that record again.

Reasons that do justify it are about the submission rather than the solver: a
licensing or legal complaint, credentials or private data committed by mistake,
or an entry that should never have been accepted. "This solver is dead" is not
one of them.

```bash
git rm -r solvers/<id>              # every release
git rm -r solvers/<id>/<version>/   # or one of them
```

No other step is needed. `build.py` compares the database against the
submissions that exist, so the next collection drops the records and logs
`submission deleted` rather than `retired`. The two are distinguished in the
log because they mean different things to whoever reads it later.

Note that `git rm` does not erase anything from the repository's history. If
the reason for deleting was a committed secret, rotate the secret: the old
commit still contains it.

---

## Updating

Add a new directory for the new version. Do not edit the old one. Every version
is kept.

To correct a mistake in a release already recorded, edit that version's
`install.sh`. Re-collection overwrites the existing record rather than creating
a duplicate.
