#!/usr/bin/env python3
"""
Unit tests for api/app.py, using Flask's test client: no server, no port,
no network.

    python3 tests/unit/api.py
"""

import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parents[2]

def _release(version, arithmetic):
    """One release of the `multi` fixture, identical but for its arithmetic."""
    return {
        "version": version,
        "status": "ok",
        "collected_at": f"2026-08-{10 + len(version):02d}T00:00:00Z",
        "capabilities": {
            "onnx_opset": [10, 18],
            "element_types": ["float32"],
            "operators": ["Relu"],
            "vnnlib_versions": ["2.0", "2.0"],
        },
        "satisfies": {"arithmetic": arithmetic, "hidden_nodes": ["NH"],
                      "multiple_io": ["SIO"], "multiple_networks": ["SNET"],
                      "node_comparisons": ["SNC"]},
    }


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
            # Five releases, and LIN comes and goes: 1.0.0 and 1.1.0 have it,
            # 1.2.0 and 2.0.0 lose it, 2.1.0 has it again. A LIN search must
            # therefore come back as two ranges, not one span across the hole.
            "id": "multi", "name": "Multi", "repo": "https://e/multi",
            "versions": [
                _release("1.0.0", ["BND", "OUTC", "LIN"]),
                _release("1.1.0", ["BND", "OUTC", "LIN"]),
                _release("1.2.0", ["BND"]),
                _release("2.0.0", ["BND", "OUTC"]),
                _release("2.1.0", ["BND", "OUTC", "LIN", "POLY"]),
            ],
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

        response = client.get("/search?arithmetic=BND")
        check("cross-origin allowed, or a browser cannot read this at all",
              response.headers.get("Access-Control-Allow-Origin") == "*",
              dict(response.headers))

        status, body = run(client, "/")
        check("says whether it is serving demo or collected data",
              body["source"] in ("demo", "collected"), body.get("source"))

        status, body = run(client, "/solvers")
        check("list every solver", status == 200 and len(body["solvers"]) == 4)

        status, body = run(client, "/solvers/strong")
        check("one solver", status == 200 and body["name"] == "Strong")

        status, body = run(client, "/solvers/nope")
        check("unknown solver is 404", status == 404)

        status, body = run(client, "/search")
        check("empty query matches every solver with capabilities",
              ids(body) == ["multi", "strong", "weak"], ids(body))

        status, body = run(client, "/search?arithmetic=POLY")
        check("POLY only matches solvers that reported it",
              ids(body) == ["multi", "strong"], ids(body))

        status, body = run(client, "/search?arithmetic=OUTC")
        check("closure: POLY implies OUTC", ids(body) == ["multi", "strong"], ids(body))

        status, body = run(client, "/search?arithmetic=BND")
        check("closure: every solver satisfies BND",
              ids(body) == ["multi", "strong", "weak"], ids(body))

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
        check("opset inside every range", ids(body) == ["multi", "strong", "weak"], ids(body))

        status, body = run(client, "/search?onnx_opset=9")
        check("opset outside the narrower range", ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?vnnlib_versions=1.0")
        check("vnnlib version compared as a version, not a float",
              ids(body) == ["strong"], ids(body))

        status, body = run(client, "/search?arithmetic=POLY&operators=Relu&element_types=real")
        # multi has POLY and Relu but no `real`, so it is the one the third
        # criterion removes.
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

        # ------------------------------------------- range grouping ------
        #
        # The point of computing this in the API rather than in each consumer:
        # a caller only ever receives the matching releases, so from those
        # alone it cannot tell a solid run of three from three with gaps.

        def multi(url):
            _, body = run(client, url)
            for entry in body["solvers"]:
                if entry["id"] == "multi":
                    return entry["matches"]
            return None

        m = multi("/search?arithmetic=LIN")
        check("a hole in the matches becomes two ranges, not one span",
              [(r["from"], r["to"]) for r in m["ranges"]]
              == [("1.0.0", "1.1.0"), ("2.1.0", "2.1.0")], m["ranges"])
        check("each range lists the releases it covers",
              [r["versions"] for r in m["ranges"]]
              == [["1.0.0", "1.1.0"], ["2.1.0"]], m["ranges"])
        check("counts say how much of the solver qualified",
              (m["matched"], m["total"]) == (3, 5), m)
        check("latest is the newest matching release, not the newest release",
              m["latest"]["version"] == "2.1.0", m["latest"])
        check("latest carries its own timestamp, so a row can date itself",
              m["latest"]["collected_at"] is not None, m["latest"])

        m = multi("/search")
        check("every release matching is one unbroken range",
              len(m["ranges"]) == 1
              and (m["ranges"][0]["from"], m["ranges"][0]["to"]) == ("1.0.0", "2.1.0")
              and (m["matched"], m["total"]) == (5, 5), m)

        m = multi("/search?arithmetic=POLY")
        check("a single matching release is a range of one, from equal to to",
              len(m["ranges"]) == 1
              and m["ranges"][0]["from"] == m["ranges"][0]["to"] == "2.1.0"
              and (m["matched"], m["total"]) == (1, 5), m)

        m = multi("/search?arithmetic=OUTC")
        check("consecutive runs either side of a single gap",
              [(r["from"], r["to"]) for r in m["ranges"]]
              == [("1.0.0", "1.1.0"), ("2.0.0", "2.1.0")], m["ranges"])

        _, body = run(client, "/search?arithmetic=BND")
        one = [e for e in body["solvers"] if e["id"] == "strong"][0]
        check("a one-release solver is still a range, so consumers need no special case",
              one["matches"]["ranges"] == [{"from": "1.0.0", "to": "1.0.0",
                                            "versions": ["1.0.0"]}]
              and (one["matches"]["matched"], one["matches"]["total"]) == (1, 1),
              one["matches"])

        _, body = run(client, "/search?arithmetic=LIN")
        entry = [e for e in body["solvers"] if e["id"] == "multi"][0]
        check("versions still carries only the matching records, unchanged",
              [v["version"] for v in entry["versions"]] == ["1.0.0", "1.1.0", "2.1.0"],
              [v["version"] for v in entry["versions"]])

        check("no internal bookkeeping leaks into the response",
              all("_last_index" not in r for r in entry["matches"]["ranges"]),
              entry["matches"]["ranges"])

        status, body = run(client, "/vocabulary")
        check("vocabulary lists every operator in the database, not one page's worth",
              status == 200 and body["operators"] == ["Conv", "Relu"], body.get("operators"))
        check("and every element type",
              body["element_types"] == ["float32", "real"], body.get("element_types"))

        # ------------------------------- paging, sorting and the name ----
        #
        # All three are the API's job because they cannot be split: a page of
        # ten filtered or sorted in the browser is a page of the wrong ten, and
        # a total counted from one page is not a total.

        # Twelve solvers, so the default page size of ten leaves a second page.
        many = {
            "schema_version": "1.0", "generated_at": "2026-09-25T00:00:00Z",
            "solvers": [
                {"id": f"s{n:02d}", "name": f"Solver {n:02d}",
                 "repo": f"https://e/s{n}",
                 "versions": [_release(f"{n}.0.0", ["BND"])]}
                for n in range(1, 13)
            ],
        }
        paged = pathlib.Path(tmp) / "paged.json"
        paged.write_text(json.dumps(many), encoding="utf-8")
        module.DATABASE = paged

        status, body = run(client, "/search?sort=name-asc")
        check("default page size is ten",
              body["limit"] == 10 and len(body["solvers"]) == 10, (body["limit"], len(body["solvers"])))
        check("total is the whole result set, not the page",
              body["total"] == 12, body["total"])
        check("the page is the first ten in sort order",
              ids(body) == [f"s{n:02d}" for n in range(1, 11)], ids(body))

        status, body = run(client, "/search?sort=name-asc&limit=10&offset=10")
        check("offset moves the window",
              ids(body) == ["s11", "s12"] and body["total"] == 12, ids(body))

        status, body = run(client, "/search?sort=name-asc&limit=5&offset=5")
        check("a window in the middle",
              ids(body) == ["s06", "s07", "s08", "s09", "s10"], ids(body))

        status, body = run(client, "/search?offset=99")
        check("an offset past the end is an empty page, not an error",
              status == 200 and body["solvers"] == [] and body["total"] == 12, body["total"])

        status, body = run(client, "/search?limit=9999")
        check("limit is capped rather than honoured",
              body["limit"] == module.MAX_LIMIT, body["limit"])

        status, body = run(client, "/search?limit=nonsense&offset=-4")
        check("nonsense limit and offset fall back to the defaults",
              body["limit"] == module.DEFAULT_LIMIT and body["offset"] == 0,
              (body["limit"], body["offset"]))

        status, body = run(client, "/search?sort=name-desc&limit=3")
        check("descending name", ids(body) == ["s10", "s11", "s12"], ids(body))

        # "Solver 01" does not contain "solver 1"; "Solver 10" does. The point
        # is that it is a substring test, not a word or prefix test.
        status, body = run(client, "/search?name=solver%201&sort=name-asc")
        check("name is a substring of the display name, case-insensitively",
              body["total"] == 3 and ids(body) == ["s10", "s11", "s12"], ids(body))

        status, body = run(client, "/search?name=SOLVER%2007")
        check("and the case does not matter", ids(body) == ["s07"], ids(body))

        status, body = run(client, "/search?name=s0&sort=name-asc&limit=3")
        check("the name narrows the total, so the pager counts what is reachable",
              body["total"] == 9 and len(body["solvers"]) == 3, (body["total"], len(body["solvers"])))

        status, body = run(client, "/search?name=nothinglikethis")
        check("a name matching nothing is an empty result",
              body["total"] == 0 and body["solvers"] == [])

        status, body = run(client, "/search?sort=sideways")
        check("an unknown sort is rejected, not quietly replaced",
              status == 400 and "sort" in body["error"], body)

        # 10.0.0 after 9.0.0, which a plain string comparison gets backwards.
        status, body = run(client, "/search?sort=version-desc&limit=4")
        check("versions sort naturally, not as strings",
              [s["matches"]["latest"]["version"] for s in body["solvers"]]
              == ["12.0.0", "11.0.0", "10.0.0", "9.0.0"],
              [s["matches"]["latest"]["version"] for s in body["solvers"]])

        status, body = run(client, "/search?sort=version-asc&limit=3")
        check("and ascending", [s["matches"]["latest"]["version"] for s in body["solvers"]]
              == ["1.0.0", "2.0.0", "3.0.0"],
              [s["matches"]["latest"]["version"] for s in body["solvers"]])

        # Paging must not lose or repeat a solver: every page, concatenated, is
        # the whole set exactly once.
        seen = []
        for offset in range(0, 12, 5):
            _, chunk = run(client, f"/search?sort=name-asc&limit=5&offset={offset}")
            seen += [s["id"] for s in chunk["solvers"]]
        check("walking the pages visits every solver exactly once",
              seen == sorted(s["id"] for s in many["solvers"]), seen)

        status, body = run(client, "/search?sort=name-asc")
        check("the response echoes what it was asked for",
              (body["sort"], body["limit"], body["offset"], body["name"])
              == ("name-asc", 10, 0, ""), body.get("sort"))

        module.DATABASE = path
        os.utime(path, (time.time() + 2, time.time() + 2))

        # A corrupt or half-written database must degrade to "no solvers, here
        # is why", not 500 on every endpoint until someone reads the log.
        broken = pathlib.Path(tmp) / "broken.json"
        broken.write_text("{oops", encoding="utf-8")
        module.DATABASE = broken
        status, body = run(client, "/health")
        check("corrupt database reports itself instead of crashing",
              status == 200 and body["ok"] is False and "error" in body, body)
        status, body = run(client, "/search")
        check("search over a corrupt database is empty, not a 500",
              status == 200 and body["count"] == 0, status)

        broken.write_text('{"solvers": [{"id": "x"}]}', encoding="utf-8")
        os.utime(broken, (time.time() + 5, time.time() + 5))
        status, body = run(client, "/search")
        check("solver entry with no versions does not crash search",
              status == 200 and body["count"] == 0, status)

        module.DATABASE = path

        module.DATABASE = path

        # The file changing on disk is picked up without a restart.
        changed = json.loads(json.dumps(DATABASE))
        changed["solvers"] = changed["solvers"][:1]
        path.write_text(json.dumps(changed), encoding="utf-8")
        os.utime(path, (time.time() + 1, time.time() + 1))
        status, body = run(client, "/solvers")
        check("database reloaded when the file changes", len(body["solvers"]) == 1)

        print(f"\n{len(checks)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
