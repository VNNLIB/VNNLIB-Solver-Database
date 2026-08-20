# VNN-LIB Solver Database

A searchable record of what each neural network verifier can do, collected
automatically from the verifiers themselves.

Verifiers that conform to [VNN-LIB 2.0](https://www.vnnlib.org/) implement a
`supports` command that reports their capabilities. This repository installs
each registered solver once, asks it, records the answer, and throws the solver
away. Everything downstream reads the recorded answers and never touches a
solver again.

## Repository layout

```
solvers/<id>/<version>/       one directory per solver release
    install.sh                  how to install it
    solver.toml                 who wrote it, where it lives

data/solvers.json             the collected solvers

scripts/                      the collection pipeline
    validate.py                 check a submission, installing nothing
    register.py                 install it, hand it to collect, tear down
    collect.py                  ask the solver what it supports
    build.py                    merge records into the database
    report.py                   render records as markdown for a PR comment
    schema.py                   constants the others must agree on

api/                          read-only HTTP API over the database
src/vnnfilter/                the Python package
tests/
    unit/                       pure functions, no solver, milliseconds
    integration/                the whole pipeline against fake solvers
    fixtures/                   fake solvers, one per outcome

docs/SUBMITTING.md            what a submission must contain
docs/SCHEMA.md                what the database records mean
```

Each directory has its own README: [scripts](scripts/README.md) for the
pipeline, [tests](tests/README.md) for how to run everything, [api](api/README.md)
for the HTTP endpoints and hosting.

**Python 3.12**, everywhere — the workflows, the machine that collects, and
the API host. `register.py` builds each solver's virtualenv by cloning the
interpreter that runs it, so the version you launch it with is the version
solvers get installed under.

## Searching the database

```
pip install vnnfilter

vnnfilter --arithmetic POLY --operators Conv
```

Where a solver's `supports` command reports what it can do, `vnnfilter` asks the
opposite question: given what you need, which solvers can do it. Every criterion
is optional, and anything you leave out is ignored rather than assumed.

## Adding a solver

Open a pull request adding a directory under `solvers/`. See
[docs/SUBMITTING.md](docs/SUBMITTING.md).

A workflow will install your solver and post its capabilities as a comment on
the pull request, so you can see exactly what will be recorded before anyone
merges it.

