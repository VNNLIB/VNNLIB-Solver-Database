"""vnnfilter — search the VNN-LIB Solver Database.

Where a solver's ``supports`` command reports what it can do, ``vnnfilter``
asks the opposite question: given what you need, which solvers can do it.

    >>> from vnnfilter import search, Query
    >>> results = search(Query(arithmetic=["POLY"], operators=["Conv"]))

See :mod:`vnnfilter.query` for the full set of criteria and
:mod:`vnnfilter.data` for how the database is loaded.
"""

from vnnfilter.data import DataError, load_database
from vnnfilter.query import Query, Match, search

__all__ = [
    "Query",
    "Match",
    "search",
    "load_database",
    "DataError",
    "__version__",
]

__version__ = "0.1.0"
