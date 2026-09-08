# VNN-LIB Website Prototype

This directory is the development version of the redesigned VNN-LIB website.
It follows the client request to split the original single-page site into
multiple pages:

- `index.html` for the homepage, introduction, news, and project workflow
- `standards.html` for standard documents
- `solvers.html` for solver capability search
- `libraries.html` for VNN-LIB libraries
- `related.html` for related projects

All pages share `css/site.css` so the prototype presents as one consistent
site. The Solvers page reads the local database at `../data/solvers.json`,
shows matching solver releases in a table, and can be served as a static site.

The current Solvers page filters in the browser so it can be developed and
reviewed without a deployed server. The intended production integration is to
query the web API that wraps the Python compatibility package, while keeping
the same filter fields and result structure.

With no filters selected, the page shows every recorded solver release,
including failed or non-conforming submissions. Capability filters only match
releases that have a `capabilities` record; use the Status filter to inspect
failed or incomplete records directly.

The filter names mirror `vnnfilter.Query`: `onnx_opset`, `element_types`,
`operators`, `vnnlib_version`, `hidden_nodes`, `multiple_io`,
`multiple_networks`, `node_comparisons`, `arithmetic`,
`optimised_disjunction`, and `serialise_assignments`.

From the repository root:

```bash
python -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/website/
```

Keep feature work here first. Once the site is reviewed, copy the stable pages,
shared CSS, and solver search JavaScript into the `vnnlib.github.io` repository
for publication.
