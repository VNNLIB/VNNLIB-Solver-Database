from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Iterable

THEORY_FIELDS = {
    "hidden_nodes",
    "multiple_io",
    "multiple_networks",
    "node_comparisons",
    "arithmetic",
}

@dataclass(frozen=True)
class Query:
    onnx_opset: int | None= None
    element_types: tuple[str, ...] = field(default_factory=tuple)
    operators: tuple[str, ...] = field(default_factory=tuple)
    vnnlib_version: str|None = None
    hidden_nodes: str |None = None
    multiple_io: str | None= None
    multiple_networks: str| None=None
    node_comparisons: str |None= None
    arithmetic: tuple[str, ...] =field(default_factory=tuple)
    optimised_disjunction : bool |None= None
    serialise_assignments: bool | None=None

    def is_empty(self) ->bool:
        return self== Query()

@dataclass(frozen=True)
class Match:
    solver_id: str
    name: str
    repo: str 
    version: str
    status: str
    capabilities: dict
    satisfies:dict


def _version_key(v: str)-> tuple:
    parts= str(v).split(".")
    return tuple(int(p) if p.isdigit() else p  for p in parts)

def _within_range(value:Any, bounds:Any)->bool:
    if not isinstance(bounds, (list, tuple)) or len(bounds) != 2:
        return False
    lo, hi = bounds
    try:
        v= _version_key(value)
        return _version_key(lo) <= v <= _version_key(hi)
    except (TypeError, ValueError):
        return False



def _matches_version(version_record:dict, query:Query)->bool:
    capabilities = version_record.get("capabilities")
    satisfies = version_record.get("satisfies")

    if query.onnx_opset is not None:
        if not capabilities or not _within_range(query.onnx_opset, capabilities.get("onnx_opset")):
            return False

    if query.element_types:
        supported = capabilities.get("element_types") if capabilities else None
        if not supported or not set(query.element_types) <= set(supported):
            return False

    if query.operators:
        ops = capabilities.get("operators") if capabilities else None
        if not ops or  not all(op in ops for op in query.operators):
            return False
        if query.element_types:
            for op in query.operators:
                restriction = ops[op]
                if restriction and not set(query.element_types) <= set(restriction):
                    return False

    if query.vnnlib_version is not None:
        if not capabilities or not _within_range(query.vnnlib_version, capabilities.get("vnnlib_versions")):
            return False

    for f in ("hidden_nodes", "multiple_io", "multiple_networks", "node_comparisons"):
        wanted = getattr(query, f)
        if wanted is not None:
            closure = satisfies.get(f) if satisfies else None
            if not closure or wanted not in closure:
                return False

    if query.arithmetic:
        closure = satisfies.get("arithmetic") if satisfies else None
        if not closure or not set(query.arithmetic) <=set(closure):
            return False

    if query.optimised_disjunction is not None:
        if not capabilities or capabilities.get("optimised_disjunction") != query.optimised_disjunction:
            return False

    if query.serialise_assignments is not None:
        if not capabilities or capabilities.get("serialise_assignments") != query.serialise_assignments:
            return False

    

    return True

def search(query:Query, database:dict) -> list[Match]:

    results: list[Match] = []
    for solver in  database.get("solvers", []):
        for version_record in solver.get("versions" , []):
            if _matches_version(version_record, query):
                results.append(
                    Match(
                        solver_id=solver.get("id", ""),
                        name=solver.get("name", solver.get("id", "")),
                        repo=solver.get("repo", ""),
                        version=version_record.get("version", ""),
                        status=version_record.get("status", ""),
                        capabilities=version_record.get("capabilities") or {},
                        satisfies=version_record.get("satisfies") or {},
                    )
                )

    return results



 