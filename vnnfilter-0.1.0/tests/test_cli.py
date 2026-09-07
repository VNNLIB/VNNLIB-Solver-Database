import json
from pathlib import Path

from vnnfilter.cli import main

SAMPLE = str(Path(__file__).resolve().parent.parent / "data" / "solvers.sample.json")


def test_readme_example_as_json(capsys):
    rc = main(["--data-file", SAMPLE, "--arithmetic", "POLY", "--operators", "Conv", "--json"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert [r["id"] for r in out] == ["vibecheck"]


def test_table_output_lists_repo(capsys):
    rc = main(["--data-file", SAMPLE, "--operators", "Relu"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "vibecheck" in out
    assert "brokennn" in out
    assert "github.com" in out


def test_no_matches_prints_message(capsys):
    rc = main(["--data-file", SAMPLE, "--operators", "NoSuchOp"])
    assert rc == 0
    assert "No solvers match." in capsys.readouterr().out


def test_bad_data_file_reports_error_and_exits_nonzero(capsys, tmp_path):
    missing = tmp_path / "missing.json"
    rc = main(["--data-file", str(missing)])
    assert rc == 1
    assert "no such file" in capsys.readouterr().err
