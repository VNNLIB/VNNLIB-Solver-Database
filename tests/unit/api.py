#!/usr/bin/env python3
"""
Unit tests for api/app.py, using Flask's test client — no server, no port,
no network.

    python3 tests/unit/api.py
"""

import importlib.util
import json
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parents[2]

# One release of each shape the filter has to handle.
DATABASE = {
    "schema_version": "1.0",
    "generated_at": "2026-08-17T00:00:00Z",
    "solvers": [
        {
            "id": "strong", "name": "Strong", "repo": "https://e/strong",
            "versions": [{
                "version": "1.0.0", "status": "ok",
                "capabilities": {
                    "onnx_opset": [8, 20],
                    "element_types": ["real", "float32"],
                    "operators": ["Conv float64 float32", "Relu"],
                    "vnnlib_versions": ["1.0", "2.0"],
                },
                # Reported POLY, so the closure covers the weaker ones.
                "satisfies": {"arithmetic": ["BND", "OUTC", "LIN", "POLY"],
                              "hidden_nodes": ["NH", "H"],
                              "multiple_io": ["SIO"],
                              "multiple_networks": ["SNET"],
                              "node_comparisons": ["SNC"]},
            }],
        },
        {
            "id": "weak", "name": "Weak", "repo": "https://e/weak",
            "versions": [{
                "version": "0.1.0", "status": "ok",
                "capabilities": {
                    "onnx_opset": [15, 18],
                    "element_types": ["float32"],
                    "operators": ["Relu"],
                    "vnnlib_versions": ["2.0", "2.0"],
                },
                "satisfies": {"arithmetic": ["BND"], "hidden_nodes": ["NH"],
                              "multiple_io": ["SIO"], "multiple_networks": ["SNET"],
                              "node_comparisons": ["SNC"]},
            }],
        },
        {
            "id": "broken", "name": "Broken", "repo": "https://e/broken",
            # install_failed: no capabilities at all.
            "versions": [{"version": "1.0.0", "status": "install_failed",
                          "errors": ["install script exited 1: boom"]}],
        },
    ],
}


def load_app(database_path):
    spec = importlib.util.spec_from_file_location("solver_api", REPO / "api" / "app.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["solver_api"] = module
    spec.loader.exec_module(module)
    module.DATABASE = pathlib.Path(database_path)
    module.app.config["TESTING"] = True
    return module, module.app.test_client()


def ids(payload):
    return sorted(s["id"] for s in payload["solvers"])


def run(client, url):
    response = client.get(url)
    return response.status_code, json.loads(response.data)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        path = pathlib.Path(tmp) / "solvers.json"
        path.write_text(json.dumps(DATABASE), encoding="utf-8")
        module, client = load_app(path)

        checks = []

        def check(name, condition, detail=""):
            assert condition, f"{name}: {detail}"
            checks.append(name)
            print(f"ok  {name}")

        status, body = run(client, "/health")
        check("health", status == 200 and body["ok"])

        status, body = run(client, "/solvers")
        check("list every solver", status == 200 and len(body["solvers"]) == 3)

        status, body = run(client, "/solvers/strong")
        check("one solver", status == 200 and body["name"] == "Strong")

        status, body = run(client, "/solvers/nope")
        check("unknown solver is 404", status == 404)

        status, body = run(client, "/search")
        check("empty query matches every solver with capabilities",
              ids(body) == ["strong", "weak"], ids(body))

        status, body = run(client, "/search?arithmetic=POLY")
        check("POLY only matches the solver that reported it", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?arithmetic=OUTC")
        check("closure: POLY implies OUTC", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?arithmetic=BND")
        check("closure: both satisfy BND", ids(body) == ["strong", "weak"], ids(body))

        status, body = run(client, "/search?operators=Conv")
        check("operator matched by name, ignoring its type list",
              ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?operators=Conv,Relu")
        check("several operators mean all of them", ids(body) == ["strong"], ids(body))

        # "Conv float64 float32" -> restricted to those two types.
        status, body = run(client, "/search?operators=Conv:float64")
        check("operator at a listed type", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?operators=Conv:bfloat16")
        check("operator at a type it is not listed for", body["count"] == 0)

        # "Relu" with no types means every type in element_types, not none.
        status, body = run(client, "/search?operators=Relu:real")
        check("empty type list means every element type, not none",
              ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?operators=Relu:float64")
        check("empty type list is still bounded by element_types",
              body["count"] == 0, ids(body))

        module_ops = module.operator_types({"operators": {"Conv": ["float64"], "Relu": []}})
        check("object shape from SCHEMA.md parses too",
              module_ops == {"Conv": ["float64"], "Relu": []}, module_ops)

        status, body = run(client, "/search?onnx_opset=16")
        check("opset inside both ranges", ids(body) == ["strong", "weak"], ids(body))

        status, body = run(client, "/search?onnx_opset=9")
        check("opset outside the narrower range", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?vnnlib_versions=1.0")
        check("vnnlib version compared as a version, not a float",
              ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?arithmetic=POLY&operators=Relu&element_types=real")
        check("criteria combine with AND", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?arithmetic=POLY&element_types=bfloat16")
        check("one failing criterion excludes the solver", body["count"] == 0)

        status, body = run(client, "/search?arithmetic=NOPE")
        check("unknown identifier matches nothing", body["count"] == 0)

        status, body = run(client, "/search?arithmatic=POLY")
        check("misspelled filter is rejected, not ignored", status == 400, body)

        # install_failed never matches: nothing about it was measured.
        check("install_failed excluded from every search",
              all("broken" not in ids(run(client, u)[1])
                  for u in ["/search", "/search?arithmetic=BND", "/search?operators=Relu"]))

        # The file changing on disk is picked up without a restart.
        changed = json.loads(json.dumps(DATABASE))
        changed["solvers"] = changed["solvers"][:1]
        path.write_text(json.dumps(changed), encoding="utf-8")
        import os, time
        os.utime(path, (time.time() + 1, time.time() + 1))
        status, body = run(client, "/solvers")
        check("database reloaded when the file changes", len(body["solvers"]) == 1)

        print(f"\n{len(checks)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
