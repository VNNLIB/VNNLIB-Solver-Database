# Documentation

This directory, the collection pipeline and the API are one part of the project:
submissions in, a database out, and an API over it. Two reference files here, and
this one saying which to open.

| File | Read it when |
|---|---|
| [SUBMITTING.md](SUBMITTING.md) | You are adding a solver, changing one, or retiring one. Written for a solver author from outside the project |
| [SCHEMA.md](SCHEMA.md) | You are reading `data/solvers.json` and need to know what a field means and what it can be |

Documentation that belongs with code lives next to that code instead:

| Where | Covers |
|---|---|
| [`scripts/README.md`](../scripts/README.md) | The collection pipeline: how a submission becomes a database record, and the things about it that are easy to get wrong |
| [`api/README.md`](../api/README.md) | The read-only query API, and how it is deployed |
| [`tests/README.md`](../tests/README.md) | What is tested, and how to run it |
| [`README.md`](../README.md) | The project as a whole, and where to start |
