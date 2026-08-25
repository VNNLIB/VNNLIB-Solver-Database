# Solver Website Prototype

This directory is the development version of the VNN-LIB solver capability
search page. It reads the local database at `../data/solvers.json` and can be
served as a static site.

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
