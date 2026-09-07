from vnnfilter.query import Query, search


def ids(matches):
    return sorted(m.solver_id for m in matches)


def test_empty_query_matches_every_version(database):
    matches = search(Query(), database)
    assert ids(matches) == ["brokennn", "deadsolver", "vibecheck"]


def test_arithmetic_uses_satisfies_closure(database):
    # brokennn's arithmetic satisfies-closure is empty (its raw report was
    # invalid), deadsolver never installed. Only vibecheck reported POLY.
    matches = search(Query(arithmetic=("POLY",)), database)
    assert ids(matches) == ["vibecheck"]


def test_arithmetic_lower_theory_matches_via_closure(database):
    # vibecheck reported POLY, whose downward closure includes BND.
    matches = search(Query(arithmetic=("BND",)), database)
    assert ids(matches) == ["vibecheck"]


def test_operator_supported_by_multiple_solvers(database):
    matches = search(Query(operators=("Relu",)), database)
    assert ids(matches) == ["brokennn", "vibecheck"]


def test_operator_supported_by_one_solver(database):
    matches = search(Query(operators=("Conv",)), database)
    assert ids(matches) == ["vibecheck"]


def test_unsupported_operator_matches_nothing(database):
    matches = search(Query(operators=("NoSuchOp",)), database)
    assert matches == []


def test_all_requested_operators_must_be_present(database):
    matches = search(Query(operators=("Relu", "Conv")), database)
    assert ids(matches) == ["vibecheck"]


def test_onnx_opset_range(database):
    assert ids(search(Query(onnx_opset=16), database)) == ["brokennn", "vibecheck"]
    assert ids(search(Query(onnx_opset=19), database)) == ["vibecheck"]
    assert ids(search(Query(onnx_opset=25), database)) == []


def test_multiple_networks_via_satisfies(database):
    # vibecheck reported MINET, whose closure includes SNET, MENET, MINET.
    assert ids(search(Query(multiple_networks="MINET"), database)) == ["vibecheck"]
    assert ids(search(Query(multiple_networks="SNET"), database)) == ["brokennn", "vibecheck"]
    # brokennn never satisfies MNET; nobody in the sample does.
    assert ids(search(Query(multiple_networks="MNET"), database)) == []


def test_install_failed_never_matches_a_capability_criterion(database):
    matches = search(Query(onnx_opset=1), database)
    assert "deadsolver" not in ids(matches)


def test_null_field_from_incomplete_record_matches_nothing(database):
    # brokennn's node_comparisons and arithmetic were reported out-of-range
    # and recorded as null; no theory value should match a null field.
    for value in ("SNC", "MNC"):
        matches = search(Query(node_comparisons=value), database)
        assert "brokennn" not in ids(matches)


def test_element_types_requires_all(database):
    assert ids(search(Query(element_types=("float32", "float64")), database)) == ["vibecheck"]
    assert ids(search(Query(element_types=("float32",)), database)) == ["brokennn", "vibecheck"]


def test_boolean_flags(database):
    assert ids(search(Query(optimised_disjunction=True), database)) == ["vibecheck"]
    assert ids(search(Query(serialise_assignments=True), database)) == ["vibecheck"]


def test_combined_criteria_from_readme_example(database):
    matches = search(Query(arithmetic=("POLY",), operators=("Conv",)), database)
    assert ids(matches) == ["vibecheck"]
