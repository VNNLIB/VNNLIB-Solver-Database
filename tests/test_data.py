import json

import pytest

from vnnfilter.data import DataError, load_database


def test_loads_sample(database):
    assert database["schema_version"] == "1.0"
    assert len(database["solvers"]) == 3


def test_missing_file(tmp_path):
    with pytest.raises(DataError, match="no such file"):
        load_database(tmp_path / "nope.json")


def test_bad_json(tmp_path):
    p = tmp_path / "solvers.json"
    p.write_text("{not json")
    with pytest.raises(DataError, match="not valid JSON"):
        load_database(p)


def test_not_a_database(tmp_path):
    p = tmp_path / "solvers.json"
    p.write_text(json.dumps({"hello": "world"}))
    with pytest.raises(DataError, match="does not look like"):
        load_database(p)


def test_unsupported_schema_version(tmp_path):
    p = tmp_path / "solvers.json"
    p.write_text(json.dumps({"schema_version": "2.0", "solvers": []}))
    with pytest.raises(DataError, match="not understood"):
        load_database(p)


def test_env_var_overrides_bundled(monkeypatch, tmp_path):
    p = tmp_path / "solvers.json"
    p.write_text(json.dumps({"schema_version": "1.0", "solvers": []}))
    monkeypatch.setenv("VNNFILTER_DATA_FILE", str(p))
    data = load_database()
    assert data["solvers"] == []


def test_explicit_path_beats_env_var(monkeypatch, tmp_path):
    env_path = tmp_path / "env.json"
    env_path.write_text(json.dumps({"schema_version": "1.0", "solvers": ["from-env"]}))
    monkeypatch.setenv("VNNFILTER_DATA_FILE", str(env_path))

    explicit_path = tmp_path / "explicit.json"
    explicit_path.write_text(json.dumps({"schema_version": "1.0", "solvers": ["from-explicit"]}))

    data = load_database(explicit_path)
    assert data["solvers"] == ["from-explicit"]


def test_bundled_default_loads():
    # No path, no env var: falls back to the copy shipped inside the package.
    data = load_database()
    assert "schema_version" in data
    assert "solvers" in data
