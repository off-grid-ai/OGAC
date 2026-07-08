"""Great Expectations data-quality sidecar for Off Grid Console (data plane, S2-only).

A thin, Apache-2.0 service that wraps expectation evaluation behind the contract the console's
data-quality adapter calls (src/lib/adapters/data-quality.ts) — mirroring the `evidently` drift
sidecar (sidecars/drift/app.py) so the console stays Node-only while running REAL DQ checks.

    POST /checkpoint/{suite}
      { "rows": [ {col: value, ...}, ... ],
        "expectations": [ {"type": "expect_column_values_to_not_be_null", "column": "pan"},
                          {"type": "expect_column_values_to_be_between", "column": "amount",
                           "min": 0, "max": 1000000} ] }
      -> { "success": bool,
           "evaluated": int,
           "engine": str,
           "failed": [ {"type": ..., "column": ..., "unexpected_count": int, "note"?: str} ] }

The console builds the dataset window (or a warehouse-clickhouse query result) + the expectation
suite and ships them here; this service runs them and reports REAL pass/fail counts + which rules
failed.

ENGINE SELECTION — real evaluation either way:
  - If the `great_expectations` library is importable, `_ge_validate` builds a real GE
    PandasDataset, runs each expectation through GE's own validators, and maps the results.
    Reported engine: "great-expectations".
  - Otherwise the sidecar runs its OWN faithful, correct evaluator (`_native_validate`) that
    computes REAL per-expectation unexpected counts over the posted rows — matching GE's
    semantics for the console's vocabulary. Reported engine: "native".

There is NO stub / no fake "reachable but 0 evaluated" path: every posted expectation is really
evaluated over the real rows. Ports: 8003.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Off Grid — Great Expectations data-quality sidecar")

# The vocabulary the console's data-quality-model.ts emits.
SUPPORTED = {
    "expect_column_values_to_not_be_null",
    "expect_column_values_to_be_between",
    "expect_column_values_to_be_in_set",
    "expect_column_values_to_be_unique",
    "expect_column_to_exist",
}


class Expectation(BaseModel):
    type: str
    column: Optional[str] = None
    min: Optional[float] = None
    max: Optional[float] = None
    value_set: Optional[List[Any]] = None


class Checkpoint(BaseModel):
    rows: List[Dict[str, Any]] = []
    expectations: List[Expectation] = []


def _is_missing(v: Any) -> bool:
    """GE treats null/NaN as missing. We also treat the empty string as missing, matching the
    console's fallback semantics (a blank PAN/IFSC cell is not a real value)."""
    if v is None or v == "":
        return True
    # NaN is the only value not equal to itself.
    return isinstance(v, float) and v != v


def _column_exists(rows: List[Dict[str, Any]], col: Optional[str]) -> bool:
    """A column exists if ANY row carries the key (robust to ragged rows), matching GE which
    validates against the frame's columns."""
    return bool(rows) and any(col in r for r in rows)


def _native_validate(rows: List[Dict[str, Any]], expectations: List[Expectation]) -> dict:
    """Faithful, dependency-free evaluator. Computes REAL unexpected counts per expectation over
    the real rows — a correct implementation of GE's semantics for the console's vocabulary, NOT
    a stub. Zero-IO, unit-testable.

    GE convention: `_to_not_be_null` counts nulls as unexpected; the value-family expectations
    (`_between`, `_in_set`, `_unique`) IGNORE missing values (null handling is a separate
    expectation) and count only present-but-violating values. `_column_to_exist` is a
    frame-level check (unexpected_count 1 if the column is absent, else 0)."""
    failed: List[dict] = []
    for exp in expectations:
        col = exp.column
        unexpected = 0

        if exp.type == "expect_column_values_to_not_be_null":
            unexpected = sum(1 for r in rows if _is_missing(r.get(col)))

        elif exp.type == "expect_column_values_to_be_between":
            for r in rows:
                v = r.get(col)
                if _is_missing(v):
                    continue  # null handled by a separate not-null expectation
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    unexpected += 1
                    continue
                if exp.min is not None and v < exp.min:
                    unexpected += 1
                elif exp.max is not None and v > exp.max:
                    unexpected += 1

        elif exp.type == "expect_column_values_to_be_in_set":
            # An empty/absent value_set means nothing is allowed → every present value is unexpected.
            allowed = list(exp.value_set) if exp.value_set is not None else []
            for r in rows:
                v = r.get(col)
                if _is_missing(v):
                    continue
                if v not in allowed:
                    unexpected += 1

        elif exp.type == "expect_column_values_to_be_unique":
            # Every value in a duplicate group is unexpected (GE semantics).
            counts: Dict[Any, int] = {}
            present: List[Any] = []
            for r in rows:
                v = r.get(col)
                if _is_missing(v):
                    continue
                present.append(v)
                counts[v] = counts.get(v, 0) + 1
            unexpected = sum(1 for v in present if counts[v] > 1)

        elif exp.type == "expect_column_to_exist":
            unexpected = 0 if _column_exists(rows, col) else 1

        else:
            failed.append({
                "type": exp.type, "column": col, "unexpected_count": -1,
                "note": f"unsupported expectation type: {exp.type}",
            })
            continue

        if unexpected > 0:
            failed.append({"type": exp.type, "column": col, "unexpected_count": unexpected})

    return {
        "success": len(failed) == 0,
        "evaluated": len(expectations),
        "engine": "native",
        "failed": failed,
    }


def _ge_validate(rows: List[Dict[str, Any]], expectations: List[Expectation]) -> Optional[dict]:
    """Run the REAL Great Expectations engine if the library is importable. Returns None if GE
    isn't available so the caller falls back to the native evaluator (equally real).

    Builds a GE PandasDataset from the posted rows and calls GE's own expectation validators;
    maps each result into the response shape. Both engines produce the same contract."""
    try:
        import pandas as pd
        import great_expectations as ge  # noqa: F401
        from great_expectations.dataset import PandasDataset
    except Exception:
        return None

    df = pd.DataFrame(rows if rows else [])
    dataset = PandasDataset(df)
    failed: List[dict] = []

    for exp in expectations:
        col = exp.column
        try:
            if exp.type == "expect_column_to_exist":
                res = dataset.expect_column_to_exist(col)
                if not bool(res.success):
                    failed.append({"type": exp.type, "column": col, "unexpected_count": 1})
                continue

            if col is not None and col not in df.columns:
                # A value-level expectation on a missing column can't be evaluated the way the
                # console means it; surface it honestly rather than crashing.
                failed.append({"type": exp.type, "column": col, "unexpected_count": -1,
                               "note": f"column '{col}' not present"})
                continue

            if exp.type == "expect_column_values_to_not_be_null":
                res = dataset.expect_column_values_to_not_be_null(col)
            elif exp.type == "expect_column_values_to_be_between":
                res = dataset.expect_column_values_to_be_between(col, min_value=exp.min, max_value=exp.max)
            elif exp.type == "expect_column_values_to_be_in_set":
                res = dataset.expect_column_values_to_be_in_set(col, list(exp.value_set or []))
            elif exp.type == "expect_column_values_to_be_unique":
                res = dataset.expect_column_values_to_be_unique(col)
            else:
                failed.append({"type": exp.type, "column": col, "unexpected_count": -1,
                               "note": f"unsupported expectation type: {exp.type}"})
                continue

            if not res.success:
                unexpected = int((res.result or {}).get("unexpected_count", 0) or 0)
                failed.append({"type": exp.type, "column": col,
                               "unexpected_count": unexpected if unexpected > 0 else 1})
        except Exception as e:  # never let one bad expectation take down the checkpoint
            failed.append({"type": exp.type, "column": col, "unexpected_count": -1,
                           "note": f"evaluation error: {e}"})

    return {
        "success": len(failed) == 0,
        "evaluated": len(expectations),
        "engine": "great-expectations",
        "failed": failed,
    }


def _engine_available() -> str:
    try:
        import great_expectations  # noqa: F401
        return "great-expectations"
    except Exception:
        return "native"


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "great-expectations", "engine": _engine_available()}


@app.post("/checkpoint/{suite}")
def checkpoint(suite: str, cp: Checkpoint) -> dict:
    result = _ge_validate(cp.rows, cp.expectations)
    if result is not None:
        return result
    return _native_validate(cp.rows, cp.expectations)
