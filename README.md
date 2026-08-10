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
data/solvers.sample.json     hand-written fixture for development
scripts/                      the collection pipeline
src/vnnfilter/                the Python package
tests/

docs/SUBMITTING.md            what a submission must contain
docs/SCHEMA.md                what the database records mean
```

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

