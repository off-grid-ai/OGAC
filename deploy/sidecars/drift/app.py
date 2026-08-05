"""Evidently drift sidecar for Off Grid Console.

A thin, Apache-2.0 service that wraps Evidently behind the exact contract the console's `evidently`
drift adapter calls (src/lib/adapters/drift.ts):

    POST /iterate/{project}
      {
        "reference": [..numbers..],            # required, or "columns" for the tabular form
        "current":   [..numbers..],
        "columns":   {"score": {"reference": [...], "current": [...]}, ...},   # optional, multi-column
        "preset":    "data_drift" | "data_quality" | "data_summary",           # optional
        "method":    "psi" | "ks" | "chisquare" | "wasserstein" | "jensenshannon" | "cramer_von_mises",
        "column_methods": {"score": "psi", "latency": "ks"},                  # optional overrides
        "drift_share_threshold": 0.3                                          # optional
      }
      -> {
        "drift_detected": bool,
        "share_drifted": float,
        "engine": "evidently" | "first-party-psi",     # WHICH ENGINE ACTUALLY RAN
        "preset_applied": str | null,                  # what was really executed, not what was asked
        "methods_applied": {"score": "psi", ...},
        "columns": [{"column": "score", "drifted": bool, "score": float, "method": str}],
        "evidently_version": str | null,
        "note": str | null
      }

WHAT CHANGED AND WHY. This service used to accept only `reference`/`current` and always construct
`DataDriftPreset`, so the preset, the stat-test method and the per-column overrides the console sends
were silently discarded. The console then reported `Evidently ran "<selection>"` — a claim about work
that never happened. Worse, when Evidently could not run (fewer than 2 points, or the import failing)
this fell back to a locally computed PSI and returned the SAME response shape, so an operator could
not tell whether a drift verdict came from Evidently or from a rough first-party approximation.

So every response now names the engine that produced it, the preset that was really executed and the
method really applied per column. `preset_applied` is the truth, not the request: if a preset is asked
for and cannot be run, the field says what ran instead and `note` says why.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Off Grid — Evidently drift sidecar")

# The stat tests the console's catalogue offers → Evidently's own token. Kept as an explicit map so an
# unknown token is REFUSED rather than quietly becoming the default test: "the method you chose was
# ignored" is exactly the failure this file exists to stop.
METHOD_TOKENS: Dict[str, str] = {
    "psi": "psi",
    "ks": "ks",
    "chisquare": "chisquare",
    "wasserstein": "wasserstein",
    "jensenshannon": "jensenshannon",
    # Evidently spells this one without the "von": the console catalogue uses the statistical name, so
    # the mapping lives here rather than making the UI speak the library's dialect.
    "cramer_von_mises": "cramer_von_mises",
    "cramer": "cramer_von_mises",
}

PRESETS = {"data_drift", "data_quality", "data_summary"}


class ColumnWindow(BaseModel):
    reference: List[float] = []
    current: List[float] = []


class Window(BaseModel):
    reference: List[float] = []
    current: List[float] = []
    columns: Optional[Dict[str, ColumnWindow]] = None
    preset: Optional[str] = None
    method: Optional[str] = None
    column_methods: Optional[Dict[str, str]] = None
    drift_share_threshold: Optional[float] = None


def _psi(reference: List[float], current: List[float], bins: int = 4) -> float:
    """Population Stability Index — the fallback when Evidently cannot run (too few points)."""
    if not reference or not current:
        return 0.0
    lo, hi = min(reference + current), max(reference + current)
    if hi == lo:
        return 0.0
    width = (hi - lo) / bins
    edges = [lo + i * width for i in range(bins + 1)]  # noqa: F841 — kept for readability

    def hist(xs: List[float]) -> List[float]:
        counts = [0] * bins
        for x in xs:
            idx = min(bins - 1, int((x - lo) / width))
            counts[idx] += 1
        n = len(xs)
        return [(c + 0.5) / (n + 0.5 * bins) for c in counts]

    r, c = hist(reference), hist(current)
    return round(sum((c[i] - r[i]) * math.log(c[i] / r[i]) for i in range(bins)), 4)


def _frames(window: Window) -> Dict[str, ColumnWindow]:
    """Normalise both request shapes to a column map, so one code path handles either."""
    if window.columns:
        return window.columns
    return {"score": ColumnWindow(reference=window.reference, current=window.current)}


def _evidently_version() -> Optional[str]:
    try:
        import evidently

        return getattr(evidently, "__version__", None)
    except Exception:
        return None


def _run_evidently(window: Window) -> Optional[dict]:
    """Run the REQUESTED preset with the REQUESTED per-column methods. None if it cannot run."""
    try:
        from evidently.metric_preset import DataDriftPreset, DataQualityPreset
        from evidently.report import Report
    except Exception:
        return None

    cols = _frames(window)
    if not cols:
        return None
    # Evidently needs at least two points per side, per column. Enforced before running so the caller
    # gets a REASON rather than a library traceback.
    for name, cw in cols.items():
        if len(cw.reference) < 2 or len(cw.current) < 2:
            return None

    ref = pd.DataFrame({name: cw.reference for name, cw in cols.items()})
    cur = pd.DataFrame({name: cw.current for name, cw in cols.items()})

    requested = (window.preset or "data_drift").strip().lower()
    if requested not in PRESETS:
        requested = "data_drift"

    # Per-column stat tests: the column override wins over the request-wide method, which is the whole
    # point of an override. An unknown token is dropped and reported, never silently defaulted.
    methods: Dict[str, str] = {}
    unknown: List[str] = []
    for name in cols:
        token = (window.column_methods or {}).get(name) or window.method
        if not token:
            continue
        mapped = METHOD_TOKENS.get(str(token).strip().lower())
        if mapped is None:
            unknown.append(str(token))
            continue
        methods[name] = mapped

    try:
        if requested == "data_quality":
            preset = DataQualityPreset()
            applied = "data_quality"
        elif requested == "data_summary":
            # Evidently 0.4 has no DataSummaryPreset; DataQualityPreset is its summary of a dataset.
            # Reported as what actually ran, so the console never claims a preset that does not exist.
            preset = DataQualityPreset()
            applied = "data_quality"
        else:
            preset = (
                DataDriftPreset(per_column_stattest=methods) if methods else DataDriftPreset()
            )
            applied = "data_drift"
        report = Report(metrics=[preset])
        report.run(reference_data=ref, current_data=cur)
        # A preset expands to SEVERAL metrics and the per-column detail is not on the first one. On
        # 0.4.40 DataDriftPreset yields DatasetDriftMetric (the dataset verdict) then DataDriftTable
        # (drift_by_columns). Reading metrics[0] only gave the summary, so every column reported
        # drifted=false and score=null while the dataset said 100% drifted — per-column evidence that
        # contradicted the verdict beside it. Merge across metrics and take the first that carries each
        # key, so this keeps working if the ordering changes.
        metrics = report.as_dict().get("metrics") or []
        result = {}
        for entry in metrics:
            for key, value in (entry.get("result") or {}).items():
                result.setdefault(key, value)
    except Exception as exc:  # a preset/method combination the installed version refuses
        return {
            "_failed": f"{type(exc).__name__}: {exc}"[:200],
        }

    per_column = []
    by_col = (result.get("drift_by_columns") or {}) if isinstance(result, dict) else {}
    for name in cols:
        entry = by_col.get(name) or {}
        per_column.append(
            {
                "column": name,
                "drifted": bool(entry.get("drift_detected", False)),
                "score": _round(entry.get("drift_score")),
                # `stattest_name` is Evidently's own label for the test it ran — preferred over the
                # token we asked for, because it is evidence rather than intent.
                "method": entry.get("stattest_name") or methods.get(name) or "default",
                "threshold": _round(entry.get("stattest_threshold")),
            }
        )

    share = float(result.get("share_of_drifted_columns", 0.0) or 0.0)
    threshold = window.drift_share_threshold
    detected = (
        share > threshold if threshold is not None else bool(result.get("dataset_drift", False))
    )
    note = None
    if unknown:
        note = f"ignored unrecognised method token(s): {', '.join(sorted(set(unknown)))}"
    if requested != applied:
        extra = f'"{requested}" is not available in this Evidently build; ran "{applied}" instead'
        note = f"{note}; {extra}" if note else extra

    return {
        "drift_detected": detected,
        "share_drifted": share,
        "engine": "evidently",
        "preset_applied": applied,
        "methods_applied": methods,
        "columns": per_column,
        "evidently_version": _evidently_version(),
        "note": note,
    }


def _round(value) -> Optional[float]:
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


@app.get("/")
def health() -> dict:
    return {
        "status": "ok",
        "service": "evidently-drift",
        "evidently_version": _evidently_version(),
        # Advertised so the console can show what this deployment can actually do rather than assume.
        "presets": sorted(PRESETS),
        "methods": sorted(set(METHOD_TOKENS)),
    }


@app.post("/iterate/{project}")
def iterate(project: str, window: Window) -> dict:
    result = _run_evidently(window)
    failure = (result or {}).get("_failed") if isinstance(result, dict) else None
    if result is not None and not failure:
        return result

    # FALLBACK — and it says so. Returning the same shape without naming the engine is how a rough
    # first-party approximation became indistinguishable from a real Evidently verdict.
    cols = _frames(window)
    per_column = []
    worst = 0.0
    for name, cw in cols.items():
        value = _psi(cw.reference, cw.current)
        worst = max(worst, value)
        per_column.append(
            {"column": name, "drifted": value >= 0.25, "score": value, "method": "psi"}
        )
    threshold = window.drift_share_threshold
    drifted_share = (
        sum(1 for c in per_column if c["drifted"]) / len(per_column) if per_column else 0.0
    )
    reason = failure or (
        "Evidently is not installed in this sidecar"
        if _evidently_version() is None
        else "each window needs at least 2 points for Evidently"
    )
    return {
        "drift_detected": (
            drifted_share > threshold if threshold is not None else worst >= 0.25
        ),
        "share_drifted": min(1.0, drifted_share if threshold is not None else worst),
        "engine": "first-party-psi",
        "preset_applied": None,
        "methods_applied": {c["column"]: "psi" for c in per_column},
        "columns": per_column,
        "evidently_version": _evidently_version(),
        "note": f"Evidently did not run ({reason}); this verdict is a first-party PSI approximation.",
    }
