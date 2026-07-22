"""Persistent, tenant-isolated GX Core lifecycle service.

This module owns GX Core and filesystem I/O. ``app.py`` owns HTTP/auth only. Every tenant gets a
separate GX File Data Context, so the GX Expectations, Validation Definitions, Checkpoints, and
Validation Results stores are physically separated on disk instead of relying on result filtering.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import great_expectations as gx
import pandas as pd
from great_expectations.core import RunIdentifier


GX_CORE_VERSION = gx.__version__
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
MAX_ASSET_BYTES = 32 * 1024 * 1024
MAX_INLINE_ROWS = 5_000
MAX_ASSET_ROWS = 100_000
MAX_EXPECTATIONS = 200


class LifecycleError(Exception):
    """A typed failure safe to map at the HTTP boundary."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _identifier(value: Any, label: str) -> str:
    candidate = value.strip() if isinstance(value, str) else ""
    if not IDENTIFIER.fullmatch(candidate):
        raise LifecycleError(
            f"{label} must be 1-128 letters, numbers, dots, dashes, or underscores."
        )
    return candidate


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _expectation(spec: Dict[str, Any]) -> Any:
    expectation_type = spec.get("type")
    kwargs = spec.get("kwargs")
    if not isinstance(expectation_type, str) or not isinstance(kwargs, dict):
        raise LifecycleError("each expectation requires type and kwargs.")
    column = kwargs.get("column")
    if not isinstance(column, str) or not column.strip():
        raise LifecycleError(f"{expectation_type} requires a column.")

    if expectation_type == "expect_column_values_to_not_be_null":
        return gx.expectations.ExpectColumnValuesToNotBeNull(column=column)
    if expectation_type == "expect_column_values_to_be_between":
        minimum = kwargs.get("min_value", kwargs.get("min"))
        maximum = kwargs.get("max_value", kwargs.get("max"))
        return gx.expectations.ExpectColumnValuesToBeBetween(
            column=column, min_value=minimum, max_value=maximum
        )
    if expectation_type == "expect_column_values_to_be_in_set":
        values = kwargs.get("value_set")
        if not isinstance(values, list):
            raise LifecycleError(f"{expectation_type} requires a value_set array.")
        return gx.expectations.ExpectColumnValuesToBeInSet(column=column, value_set=values)
    if expectation_type == "expect_column_values_to_be_unique":
        return gx.expectations.ExpectColumnValuesToBeUnique(column=column)
    if expectation_type == "expect_column_to_exist":
        return gx.expectations.ExpectColumnToExist(column=column)
    raise LifecycleError(f"unsupported expectation type: {expectation_type}")


def _expectation_view(expectation: Any) -> Dict[str, Any]:
    config = expectation.configuration
    return {"type": config.type, "kwargs": dict(config.kwargs)}


def _offgrid_meta(suite: Any) -> Dict[str, Any]:
    meta = suite.meta if isinstance(suite.meta, dict) else {}
    offgrid = meta.get("offgrid")
    return offgrid if isinstance(offgrid, dict) else {}


def _suite_view(suite: Any) -> Dict[str, Any]:
    meta = _offgrid_meta(suite)
    return {
        "name": suite.name,
        "description": str(meta.get("description") or ""),
        "expectations": [_expectation_view(item) for item in suite.expectations],
        "version": int(meta.get("version") or 1),
        "createdAt": str(meta.get("createdAt") or ""),
        "updatedAt": str(meta.get("updatedAt") or ""),
    }


class GxLifecycle:
    def __init__(self, state_root: Path | str) -> None:
        self.state_root = Path(state_root).resolve()
        self.state_root.mkdir(parents=True, exist_ok=True)
        self._locks: Dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()

    def _lock(self, org_id: str) -> threading.RLock:
        with self._locks_guard:
            return self._locks.setdefault(org_id, threading.RLock())

    def _tenant_root(self, org_id: str) -> Path:
        safe_org = _identifier(org_id, "org id")
        root = (self.state_root / "tenants" / safe_org).resolve()
        root.relative_to(self.state_root)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def context(self, org_id: str) -> Any:
        # GX creates ``<project_root>/gx/great_expectations.yml`` and filesystem-backed Stores.
        return gx.get_context(mode="file", project_root_dir=str(self._tenant_root(org_id)))

    def _suite(self, context: Any, name: str) -> Any:
        safe_name = _identifier(name, "suite name")
        try:
            return context.suites.get(safe_name)
        except Exception as error:
            raise LifecycleError("expectation suite not found.", 404) from error

    def list_suites(self, org_id: str) -> List[Dict[str, Any]]:
        with self._lock(org_id):
            return sorted(
                (_suite_view(suite) for suite in self.context(org_id).suites.all()),
                key=lambda suite: suite["name"],
            )

    def get_suite(self, org_id: str, name: str) -> Dict[str, Any]:
        with self._lock(org_id):
            return _suite_view(self._suite(self.context(org_id), name))

    def create_suite(
        self,
        org_id: str,
        name: str,
        description: str,
        expectations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        safe_name = _identifier(name, "suite name")
        if not 1 <= len(expectations) <= MAX_EXPECTATIONS:
            raise LifecycleError(f"expectations must contain 1-{MAX_EXPECTATIONS} entries.")
        with self._lock(org_id):
            context = self.context(org_id)
            if any(suite.name == safe_name for suite in context.suites.all()):
                raise LifecycleError("expectation suite already exists.", 409)
            timestamp = _now()
            suite = gx.ExpectationSuite(
                name=safe_name,
                expectations=[_expectation(spec) for spec in expectations],
                meta={
                    "offgrid": {
                        "version": 1,
                        "description": description.strip(),
                        "createdAt": timestamp,
                        "updatedAt": timestamp,
                    }
                },
            )
            return _suite_view(context.suites.add(suite))

    def update_suite(
        self,
        org_id: str,
        name: str,
        expected_version: int,
        description: Optional[str] = None,
        expectations: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        with self._lock(org_id):
            context = self.context(org_id)
            current = self._suite(context, name)
            current_view = _suite_view(current)
            if expected_version != current_view["version"]:
                raise LifecycleError("expectation suite version conflicts.", 409)
            next_expectations = current_view["expectations"] if expectations is None else expectations
            if not 1 <= len(next_expectations) <= MAX_EXPECTATIONS:
                raise LifecycleError(f"expectations must contain 1-{MAX_EXPECTATIONS} entries.")
            meta = _offgrid_meta(current)
            suite = gx.ExpectationSuite(
                name=current.name,
                expectations=[_expectation(spec) for spec in next_expectations],
                meta={
                    "offgrid": {
                        "version": current_view["version"] + 1,
                        "description": current_view["description"]
                        if description is None
                        else description.strip(),
                        "createdAt": str(meta.get("createdAt") or _now()),
                        "updatedAt": _now(),
                    }
                },
            )
            return _suite_view(context.suites.add_or_update(suite))

    def delete_suite(
        self, org_id: str, name: str, expected_version: Optional[int] = None
    ) -> None:
        with self._lock(org_id):
            context = self.context(org_id)
            current = self._suite(context, name)
            if expected_version is not None and expected_version != _suite_view(current)["version"]:
                raise LifecycleError("expectation suite version conflicts.", 409)
            context.suites.delete(current.name)
