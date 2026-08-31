from __future__ import annotations

import json
import os
import urllib.request
from importlib import resources
from pathlib import Path
from typing import Any

SUPPORTED_MAJOR_VERSION = "1"
ENV_VAR = "VNNFILTER_DATA_FILE"
DEFAULT_API_URL = "https://12er90.pythonanywhere.com/solvers"


class DataError(Exception):
    """The database file is missing, unreadable, or not something vnnfilter understands."""


def _read_json(text: str, *, source:str )-> dict:
    try:
        data= json.loads(text)
    except json.JSONDecodeError as exc:
        raise DataError(f"{source} : not valid JSON ({exc})") from exc
    if not isinstance(data,dict) or "solvers" not in data:
        raise DataError(f"{source}: does not look like a solvers.json (missing 'solvers')")
    return data


def _bundled_path() -> Any:
    return resources.files("vnnfilter") / "_data" / "solvers.json"


def fetch_remote(url: str, timeout: float = 5.0) ->dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            text= resp.read().decode("utf-8")
    except (OSError, TimeoutError) as exc:
        raise DataError(f"could not fetch {url}: {exc}") from exc

    return _read_json(text, source=url)


def load_database(path: str | os.PathLike | None = None, * ,url: str |None=None) -> dict:
    if url is not None:
        data = fetch_remote(url=url)
    elif path is not None:
        p = Path(path)
        if not p.is_file():
            raise DataError(f"{p}: no such file")
        data = _read_json(p.read_text(encoding="utf-8"), source=str(p))
    elif os.environ.get(ENV_VAR):
        p = Path(os.environ[ENV_VAR])
        if not p.is_file():
            raise DataError(f"${ENV_VAR}={p}: no such file")
        data = _read_json(p.read_text(encoding="utf-8"), source=str(p))
    else:
        data = fetch_remote(DEFAULT_API_URL)

    schema_version = str(data.get("schema_version", ""))
    major = schema_version.split(".", 1)[0]
    if major and major != SUPPORTED_MAJOR_VERSION:
        raise DataError(
            f"database schema_version {schema_version!r} is not understood by this version of "
            f"vnnfilter (supports {SUPPORTED_MAJOR_VERSION}.x); upgrade vnnfilter"
        )
    return data

