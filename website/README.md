# Solver Website Prototype

This directory is the development version of the VNN-LIB solver capability
search page. It reads the local database at `../data/solvers.json`, shows all
matching solver releases in a table, and can be served as a static site.

The current prototype filters in the browser so it can be developed and
reviewed without a deployed server. The intended production integration is to
query the web API that wraps the Python compatibility package, while keeping
the same filter fields and result structure.

With no filters selected, the page shows every recorded solver release,
including failed or non-conforming submissions. Capability filters only match
releases that have a `capabilities` record; use the Status filter to inspect
failed or incomplete records directly.

From the repository root:

```bash
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/website/
```

Keep feature work here first. Once the page is reviewed, copy the stable
`index.html`, `css/solvers.css`, and `js/solvers.js` changes into the
`vnnlib.github.io` repository for publication.
