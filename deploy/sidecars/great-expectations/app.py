"""Authenticated Great Expectations data-quality sidecar for Off Grid Console.

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

The legacy ``/checkpoint`` endpoint remains for existing flow gates. The governed lifecycle lives
under authenticated ``/v1`` routes and uses GX Core 1.19 File Data Context stores per tenant.

LEGACY ENGINE SELECTION — real evaluation either way:
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

import hmac
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from lifecycle import (
    GX_CORE_VERSION,
    GxLifecycle,
    LifecycleError,
    validated_identifier,
)

app = FastAPI(title="Off Grid — Great Expectations data-quality sidecar")
lifecycle: Optional[GxLifecycle] = None


def gx_lifecycle() -> GxLifecycle:
    global lifecycle
    if lifecycle is None:
        lifecycle = GxLifecycle(Path(os.environ.get("GX_STATE_ROOT", "/var/lib/offgrid-gx")))
    return lifecycle

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


class Principal(BaseModel):
    org_id: str
    actor: str


class ExpectationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    kwargs: Dict[str, Any]


class SuiteDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    description: str = Field(default="", max_length=1000)
    expectations: List[ExpectationSpec] = Field(min_length=1, max_length=200)


class SuiteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedVersion: int = Field(ge=1)
    description: Optional[str] = Field(default=None, max_length=1000)
    expectations: Optional[List[ExpectationSpec]] = Field(default=None, min_length=1, max_length=200)


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataSourceId: str
    assetName: str
    sampleLimit: int = Field(default=1000, ge=1, le=100_000)


class ValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suiteName: str
    batch: Dict[str, Any]
    idempotencyKey: Optional[str] = None


def require_principal(
    authorization: Optional[str] = Header(default=None),
    x_offgrid_org_id: Optional[str] = Header(default=None),
    x_offgrid_actor: Optional[str] = Header(default=None),
) -> Principal:
    expected = os.environ.get("OFFGRID_GX_SERVICE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Great Expectations service authentication is not configured.")
    supplied = authorization[7:].strip() if authorization and authorization.startswith("Bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        org_id = validated_identifier(x_offgrid_org_id, "org id")
    except LifecycleError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    actor = x_offgrid_actor.strip() if isinstance(x_offgrid_actor, str) else ""
    if not actor or len(actor) > 320:
        raise HTTPException(status_code=400, detail="actor is required and must be at most 320 characters.")
    return Principal(org_id=org_id, actor=actor)


@app.exception_handler(LifecycleError)
async def lifecycle_error(_request: Request, error: LifecycleError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content={"error": str(error)})


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
    return {
        "status": "ok",
        "service": "great-expectations",
        "engine": "great-expectations",
        "engineVersion": GX_CORE_VERSION,
        "lifecycle": "persistent-file-context",
    }


@app.post("/checkpoint/{suite}")
def checkpoint(suite: str, cp: Checkpoint) -> dict:
    result = _ge_validate(cp.rows, cp.expectations)
    if result is not None:
        return result
    return _native_validate(cp.rows, cp.expectations)


@app.get("/v1/capabilities")
def capabilities(_principal: Principal = Depends(require_principal)) -> dict:
    return {
        "status": "ok",
        "engine": "great-expectations",
        "engineVersion": GX_CORE_VERSION,
        "operations": {
            "profile": True,
            "validate": True,
            "suite.list": True,
            "suite.read": True,
            "suite.create": True,
            "suite.update": True,
            "suite.delete": True,
            "history.list": True,
        },
        "profileMode": "adapter-governed-asset-inspection",
    }


@app.post("/v1/profiles")
def profile(request: ProfileRequest, principal: Principal = Depends(require_principal)) -> dict:
    return gx_lifecycle().profile(
        principal.org_id, request.dataSourceId, request.assetName, request.sampleLimit
    )


@app.get("/v1/suites")
def list_suites(principal: Principal = Depends(require_principal)) -> dict:
    return {"suites": gx_lifecycle().list_suites(principal.org_id)}


@app.post("/v1/suites", status_code=201)
def create_suite(request: SuiteDraft, principal: Principal = Depends(require_principal)) -> dict:
    return gx_lifecycle().create_suite(
        principal.org_id,
        request.name,
        request.description,
        [expectation.model_dump() for expectation in request.expectations],
    )


@app.get("/v1/suites/{name}")
def get_suite(name: str, principal: Principal = Depends(require_principal)) -> dict:
    return gx_lifecycle().get_suite(principal.org_id, name)


@app.patch("/v1/suites/{name}")
def update_suite(
    name: str, request: SuiteUpdate, principal: Principal = Depends(require_principal)
) -> dict:
    if request.description is None and request.expectations is None:
        raise LifecycleError("at least one of description or expectations is required.")
    return gx_lifecycle().update_suite(
        principal.org_id,
        name,
        request.expectedVersion,
        request.description,
        None
        if request.expectations is None
        else [expectation.model_dump() for expectation in request.expectations],
    )


@app.delete("/v1/suites/{name}", status_code=204)
def delete_suite(
    name: str,
    expectedVersion: Optional[int] = Query(default=None, ge=1),
    principal: Principal = Depends(require_principal),
) -> Response:
    gx_lifecycle().delete_suite(principal.org_id, name, expectedVersion)
    return Response(status_code=204)


@app.post("/v1/validations", status_code=201)
def validate(request: ValidationRequest, principal: Principal = Depends(require_principal)) -> dict:
    return gx_lifecycle().validate(
        principal.org_id,
        request.suiteName,
        request.batch,
        request.idempotencyKey,
    )


@app.get("/v1/validations")
def validation_history(
    suiteName: Optional[str] = None,
    dataSourceId: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = None,
    principal: Principal = Depends(require_principal),
) -> dict:
    return gx_lifecycle().history(
        principal.org_id,
        limit=limit,
        suite_name=suiteName,
        data_source_id=dataSourceId,
        cursor=cursor,
    )
