# VNN-LIB Solver Database

A searchable record of what each neural network verifier can do, collected
automatically from the verifiers themselves.

Verifiers that conform to [VNN-LIB 2.0](https://www.vnnlib.org/) implement a
`supports` command that reports their capabilities. This repository installs
each registered solver once, asks it, records the answer, and throws the solver
away. Everything downstream reads the recorded answers.

A release enters the database when it installs and answers all queries, and leaves when its author retires it. Nothing is deleted from the
repository, so a retired release can be brought back.

## Layout

```
solvers/<id>/<version>/    one directory per release: install.sh, solver.toml
data/solvers.json          the collected database
scripts/                   the collection pipeline
api/                       read-only HTTP API over the database
tests/                     unit, integration and fake-solver fixtures
docs/                      how to submit, and what the database records mean
```

| Read | For |
|---|---|
| [docs/SUBMITTING.md](docs/SUBMITTING.md) | adding, updating or retiring a solver |
| [docs/SCHEMA.md](docs/SCHEMA.md) | what every field in the database means |
| [scripts/README.md](scripts/README.md) | the collection pipeline |
| [api/README.md](api/README.md) | the HTTP endpoints |
| [api/DEPLOY.md](api/DEPLOY.md) | hosting the API |
| [tests/README.md](tests/README.md) | running the tests |

**Python 3.12** everywhere: the workflows, the collecting machine and the API
host. `register.py` builds each solver's virtualenv from the interpreter running
it, so the version you launch it with is the version solvers install under.

## Adding a solver

Open a pull request adding a directory under `solvers/`, following
[docs/SUBMITTING.md](docs/SUBMITTING.md). A workflow installs it and posts its
capabilities as a comment, so you can see what will be recorded before anyone
merges.
