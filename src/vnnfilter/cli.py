from __future__ import annotations

import argparse
import json
import sys

from vnnfilter.data import DataError, load_database
from vnnfilter.query import Match, Query, search

THEORY_CHOICES = {
    "hidden_nodes": ["NH", "H"],
    "multiple_io": ["SIO", "MIO"],
    "multiple_networks": ["SNET", "MENET", "MINET", "MNET"],
    "node_comparisons": ["SNC", "MNC"],
    "arithmetic": ["BND", "OUTC", "LIN", "POLY"],
}


def _build_parse() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vnnfilter",
        description= "search the VNN-LIB Solver Database (live, unless --data-file is given) for verifiers that support what you need.",
    )
    parser.add_argument(
        "--data-file",
        metavar="path",
        help="Path to a solver.json to search instead of fetching the live database API"
        "(overrides the VNNFILTER_DATA_FILE environment variable too)",
    )
    parser.add_argument("--json", action="store_true", help="print result as json instead of a table")

    onnx = parser.add_argument_group("ONNX capabilities")
    onnx.add_argument("--onnx-opset", type=int, metavar="N", help= "required onnx opset version")
    onnx.add_argument("--element-types", nargs="+", metavar="TYPE", help="ONNX element types that must all be supported")
    onnx.add_argument("--operators", nargs="+", metavar="OP", help="ONNX operators that must all be supported")

    query_group = parser.add_argument_group("query capabilities")
    query_group.add_argument("--vnnlib-version", metavar="VERSION", help="required VNN-LIB spec version")
    query_group.add_argument("--hidden-nodes", choices=THEORY_CHOICES["hidden_nodes"])
    query_group.add_argument("--multiple-io", choices=THEORY_CHOICES["multiple_io"])
    query_group.add_argument("--multiple-networks", choices=THEORY_CHOICES["multiple_networks"])
    query_group.add_argument("--node-comparisons", choices=THEORY_CHOICES["node_comparisons"])
    query_group.add_argument(
        "--arithmetic", nargs="+", choices=THEORY_CHOICES["arithmetic"], metavar="THEORY",
        help="arithmetic theories that must all be supported",
    )
    query_group.add_argument("--optimised-disjunction", action="store_true", help="require optimised disjunctive reasoning")
    query_group.add_argument("--serialise-assignments", action="store_true", help="require ONNX TensorProto assignment output")

    return parser

def _query_from_args(args: argparse.Namespace)-> Query:
    return Query(
        onnx_opset=args.onnx_opset,
        element_types=tuple(args.element_types or ()),
        operators=tuple(args.operators or ()),
        vnnlib_version=args.vnnlib_version,
        hidden_nodes=args.hidden_nodes,
        multiple_io=args.multiple_io,
        multiple_networks=args.multiple_networks,
        node_comparisons=args.node_comparisons,
        arithmetic=tuple(args.arithmetic or ()),
        optimised_disjunction= True if args.optimised_disjunction else None,
        serialise_assignments=True if args.serialise_assignments else None,
        )

def _print_table(matches: list[Match])-> None:
    if not matches:
        print("No solvers match.")
        return
    id_w = max(len("solvers"), *(len(m.solver_id) for m in matches))
    ver_w = max(len("version"), *(len(m.version) for m in matches))
    print(f"{'solver'.ljust(id_w)} {'version'.ljust(ver_w)} repo")
    print(f"{'-' * id_w}  {'-' * ver_w}  {'-' * 4}")
    for m in matches:
            print(f"{m.solver_id.ljust(id_w)}  {m.version.ljust(ver_w)}  {m.repo}")


def _print_json(matches:list[Match])->None:
     print(
          json.dumps(
               [
                    {
                        "id": m.solver_id,
                        "name": m.name,
                        "repo": m.repo,
                        "version": m.version,
                        "status": m.status,
                        "capabilities": m.capabilities,
                        "satisfies": m.satisfies,
                    }
                    for m in matches
               ],
               indent=2,
          )
     )



def main(argv: list[str] | None= None)->int:
    parser = _build_parse()
    args = parser.parse_args(argv)

    try:
        database = load_database(args.data_file)
    except DataError as exc:
        print(f"vnnfilter: {exc}", file=sys.stderr)
        return 1

    query = _query_from_args(args)
    matches = search(query, database)

    if args.json:
         _print_json(matches)
    else : 
         _print_table(matches)

    return 0


if __name__== "__main__":
    raise SystemExit(main())

