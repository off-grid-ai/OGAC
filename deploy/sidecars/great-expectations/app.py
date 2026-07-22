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

The legacy route executes through the same pinned GX Core 1.19 ValidationDefinition path as the
governed lifecycle. There is no native fallback: a GX execution failure returns a bounded upstream
error so callers fail closed. Ports: 8003.
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


def _ge_validate(rows: List[Dict[str, Any]], expectations: List[Expectation]) -> dict:
    """Run the legacy wire contract through GX Core 1.19's public ValidationDefinition API."""
    specs = [
        {
            "type": expectation.type,
            "kwargs": {
                "column": expectation.column,
                **({"min_value": expectation.min} if expectation.min is not None else {}),
                **({"max_value": expectation.max} if expectation.max is not None else {}),
                **(
                    {"value_set": expectation.value_set}
                    if expectation.value_set is not None
                    else {}
                ),
            },
        }
        for expectation in expectations
    ]
    try:
        result = gx_lifecycle().validate_legacy_checkpoint("inline", rows, specs)
    except LifecycleError:
        raise
    except Exception as error:
        raise LifecycleError("GX checkpoint execution failed.", 502) from error
    failed = []
    for index, outcome in enumerate(result["outcomes"]):
        if outcome["success"]:
            continue
        failed.append(
            {
                "type": outcome["type"],
                "column": expectations[index].column if index < len(expectations) else None,
                "unexpected_count": outcome["unexpectedCount"],
                "note": outcome["detail"],
            }
        )
    return {
        "success": result["success"],
        "evaluated": result["evaluated"],
        "engine": "great-expectations",
        "engineVersion": GX_CORE_VERSION,
        "failed": failed,
        "validationId": result["id"],
    }


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
    # No silent native fallback: GX is pinned in the image, and execution failure is a bounded 502
    # so the Console's existing adapter produces a fail-closed verdict.
    return _ge_validate(cp.rows, cp.expectations)


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
