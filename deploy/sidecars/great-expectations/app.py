"""Great Expectations data-quality sidecar for Off Grid Console (STUB — data plane, S2-only).

A thin, Apache-2.0 service that wraps Great Expectations behind the contract the console's
(future) data-quality adapter will call — mirroring the `evidently` drift sidecar
(sidecars/drift/app.py) so the console stays Node-only while running REAL GE checks.

    POST /checkpoint/{suite}
      { "rows": [ {col: value, ...}, ... ],
        "expectations": [ {"type": "expect_column_values_to_not_be_null", "column": "pan"},
                          {"type": "expect_column_values_to_be_between", "column": "amount",
                           "min": 0, "max": 1000000} ] }
      -> { "success": bool,
           "evaluated": int,
           "failed": [ {"type": ..., "column": ..., "unexpected_count": int} ] }

The console builds the dataset window (or a warehouse-clickhouse query result) + the expectation
suite and ships them here; this service runs them and reports pass/fail + which rules failed.

STATUS: STUB. The endpoint + contract + a dependency-free fallback validator are real and testable;
the full Great Expectations engine path (`_ge_validate`) is wired but currently returns None so the
fallback runs — swap it in when the data-quality adapter lands. Keeping the heavy Python dep in a
sidecar is what lets the console stay Node-only. Ports: 8003.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Off Grid — Great Expectations data-quality sidecar")


class Expectation(BaseModel):
    type: str
    column: Optional[str] = None
    min: Optional[float] = None
    max: Optional[float] = None
    value_set: Optional[List[Any]] = None


class Checkpoint(BaseModel):
    rows: List[Dict[str, Any]] = []
    expectations: List[Expectation] = []


def _ge_validate(rows: List[Dict[str, Any]], expectations: List[Expectation]) -> Optional[dict]:
    """Run the real Great Expectations engine. Returns None if GE isn't importable / can't run,
    so the caller falls back to the dependency-free validator below.

    STUB: returns None until the data-quality adapter is built (keeps the fallback authoritative).
    The real path (roughly): build a pandas/GE `PandasDataset`, add each expectation, run
    `validate()`, and map results into the response shape. Left unwired on purpose — no app code
    ships in this scaffolding task.
    """
    return None


def _fallback_validate(rows: List[Dict[str, Any]], expectations: List[Expectation]) -> dict:
    """Dependency-free evaluator for the core expectation types — the honest floor if GE can't run.
    Real logic, unit-testable, zero heavy deps: exactly the sidecar-fallback pattern the drift
    sidecar uses (PSI fallback for Evidently)."""
    failed: List[dict] = []
    for exp in expectations:
        col = exp.column
        unexpected = 0
        if exp.type == "expect_column_values_to_not_be_null":
            unexpected = sum(1 for r in rows if r.get(col) in (None, ""))
        elif exp.type == "expect_column_values_to_be_between":
            for r in rows:
                v = r.get(col)
                if not isinstance(v, (int, float)):
                    unexpected += 1
                    continue
                if exp.min is not None and v < exp.min:
                    unexpected += 1
                elif exp.max is not None and v > exp.max:
                    unexpected += 1
        elif exp.type == "expect_column_values_to_be_in_set":
            allowed = set(exp.value_set or [])
            unexpected = sum(1 for r in rows if r.get(col) not in allowed)
        elif exp.type == "expect_column_to_exist":
            if rows and col not in rows[0]:
                unexpected = 1
        else:
            # Unknown expectation type — record it as failed so it's never silently "passed".
            failed.append({"type": exp.type, "column": col, "unexpected_count": -1,
                           "note": "unsupported in fallback; needs the GE engine"})
            continue
        if unexpected > 0:
            failed.append({"type": exp.type, "column": col, "unexpected_count": unexpected})
    return {"success": len(failed) == 0, "evaluated": len(expectations), "failed": failed}


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "great-expectations", "engine": "fallback (stub)"}


@app.post("/checkpoint/{suite}")
def checkpoint(suite: str, cp: Checkpoint) -> dict:
    result = _ge_validate(cp.rows, cp.expectations)
    if result is not None:
        return result
    return _fallback_validate(cp.rows, cp.expectations)
