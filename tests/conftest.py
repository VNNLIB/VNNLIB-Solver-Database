from pathlib import Path

import pytest

from vnnfilter.data import load_database

SAMPLE = Path(__file__).resolve().parent / "fixtures" / "solvers.sample.json"

@pytest.fixture
def database():
    return load_database(SAMPLE)
