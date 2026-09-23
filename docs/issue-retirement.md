# Publish only live, working releases to the database

## Context

`data/solvers.json` currently lists every release the pipeline has ever
collected, whatever the outcome. A release that failed to install is in there
with `status: install_failed` and no capabilities, and one that installed but
answered some of the eleven queries unusably is in there as `incomplete` with
`null` fields.

The client's position is that the database should describe what a solver can
do today. A record with nothing in it does not describe anything, and a partial
measurement invites a reader to draw conclusions from it. Matthew has also
confirmed that a solver is never to be deleted from this repository: when an
author stops maintaining one it is marked as no longer offered, so the record
of the submission survives.

Neither of those is possible today. There is no way to take a solver out of the
database short of hand-editing the JSON, which the next collection run would
overwrite.

## Problem

1. **Unusable records are published.** `install_failed` and `incomplete`
   releases reach `data/solvers.json`, so consumers have to filter them out,
   and `vnnfilter` and the website each have to know how.
2. **There is no way to retire a release.** An author whose solver is dead, or
   whose old release has been superseded, has no way to say so.
3. **A broken release is reinstalled forever.** If a submission that does not
   install gets merged, every later push that touches `solvers/` installs it
   again and waits up to 30 minutes to reach the same conclusion.

## Proposal

**Publish only clean collections.** `build.py` drops anything that is not
`status: ok` before writing. The author still gets the full detail in the
comment on their pull request, which is where a failure is useful, as feedback
rather than as a catalogue entry. A consequence worth writing down in
`SCHEMA.md`: `status` is then always `ok` in the published file.

**Retire through `solver.toml`, not by deletion.** `withdrawn = true` in
`solvers/<id>/<version>/solver.toml` retires one release; the same line in
`solvers/<id>/solver.toml`, beside the version directories, retires every
release of that solver at once, for a project abandoned rather than a release
superseded. `build.py` drops the matching records, and a solver left with no
releases goes with them. The submission itself stays in the repository, which
is what makes this reversible: the install script is still there, so setting
the flag back to `false` and letting the next collection run reproduces the
record exactly.

**Make `withdrawn` a required field**, `false` on a live release. Retiring one
is then a change to a line that is already there rather than a new key
appearing in a file, which is easier to spot in review. It also keeps the
pipeline from ever having to add the key itself to a file it is retiring, which
is how a duplicate key would get into a TOML file. That matters more than it
sounds: TOML forbids a key twice, so the file would stop parsing and the
release just retired would read as live again.

**Retire failures automatically, on `main` only.** After collecting on the main
branch, anything that did not collect cleanly gets `withdrawn = true` written
into its own `solver.toml` and committed. The state is then visible in the
repository and reviewable as a diff, rather than living only in a workflow log.
Recovery is deliberately manual: the flag records a conclusion the pipeline
reached, and only a person can say it no longer holds.

This must **not** happen on a pull request. A pull request that fails gets a
comment and nothing more, because at that point nothing has been reviewed and
the code that failed is untrusted. `pr-collect.yml` runs with `contents: read`
and cannot write to the repository at all.

**Skip the checks for a retired release.** Both workflows filter their target
list through `validate.py --list-offered` before validating or installing
anything. An old install script that has stopped working is often exactly why a
release was retired, so running it is pointless and failing the pull request
over it would be wrong.

## Acceptance criteria

- [ ] `data/solvers.json` contains only `status: ok` records
- [ ] `withdrawn` is required in every version-level `solver.toml`; a
      submission without it fails validation with a message naming the fix
- [ ] `withdrawn = true` at either level removes the matching records
- [ ] Clearing the flag and re-collecting reproduces the record exactly
- [ ] A release that fails on `main` is retired and committed; the same release
      failing in a pull request changes no file
- [ ] Retiring a release runs no checks against its `install.sh`
- [ ] A missing `solvers/` directory drops nothing, rather than emptying the
      database
- [ ] `SUBMITTING.md` and `SCHEMA.md` describe all of the above

## Out of scope

`vnnfilter` does not read `withdrawn` and does not need to: retired records are
gone from the file it reads, so it sees the right thing without changing. It
will need a new snapshot of `data/solvers.json` before its next release, since
the bundled copy still lists a record that is about to be dropped. That belongs
to the package, not here.
