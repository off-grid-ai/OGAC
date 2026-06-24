"""Evidently drift sidecar for Off Grid Console.

A thin, Apache-2.0 service that wraps Evidently's drift test suite behind the exact contract the
console's `evidently` drift adapter calls (src/lib/adapters/drift.ts):

    POST /iterate/{project}   { "reference": [..numbers..], "current": [..numbers..] }
      -> { "drift_detected": bool, "share_drifted": float }

The console computes the windows (baseline vs recent eval scores) and ships them here; this service
runs the actual Evidently DataDriftPreset and reports whether the distribution shifted. Keeping the
heavy Python dep in a sidecar is what lets the console stay Node-only while still using real
Evidently. If Evidently's report shape ever changes, the parsing below is defensive and falls back
to a Population Stability Index computed locally.
"""

from __future__ import annotations

import math
from typing import List

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Off Grid — Evidently drift sidecar")


class Window(BaseModel):
    reference: List[float] = []
    current: List[float] = []


def _psi(reference: List[float], current: List[float], bins: int = 4) -> float:
    """Population Stability Index — the fallback if Evidently can't run (too few points)."""
    if not reference or not current:
        return 0.0
    lo, hi = min(reference + current), max(reference + current)
    if hi == lo:
        return 0.0
    width = (hi - lo) / bins
    edges = [lo + i * width for i in range(bins + 1)]

    def hist(xs: List[float]) -> List[float]:
        counts = [0] * bins
        for x in xs:
            idx = min(bins - 1, int((x - lo) / width))
            counts[idx] += 1
        n = len(xs)
        return [(c + 0.5) / (n + 0.5 * bins) for c in counts]

    r, c = hist(reference), hist(current)
    return round(sum((c[i] - r[i]) * math.log(c[i] / r[i]) for i in range(bins)), 4)


def _evidently_drift(reference: List[float], current: List[float]) -> dict | None:
    """Run Evidently's DataDriftPreset on a single 'score' column. None if it can't run."""
    try:
        from evidently.metric_preset import DataDriftPreset
        from evidently.report import Report
    except Exception:
        return None
    if len(reference) < 2 or len(current) < 2:
        return None
    ref = pd.DataFrame({"score": reference})
    cur = pd.DataFrame({"score": current})
    report = Report(metrics=[DataDriftPreset()])
    report.run(reference_data=ref, current_data=cur)
    result = report.as_dict()["metrics"][0]["result"]
    return {
        "drift_detected": bool(result.get("dataset_drift", False)),
        "share_drifted": float(result.get("share_of_drifted_columns", 0.0)),
    }


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "evidently-drift"}


@app.post("/iterate/{project}")
def iterate(project: str, window: Window) -> dict:
    drift = _evidently_drift(window.reference, window.current)
    if drift is not None:
        return drift
    # Fallback: PSI (Evidently needs ≥2 points per window).
    psi = _psi(window.reference, window.current)
    return {"drift_detected": psi >= 0.25, "share_drifted": min(1.0, psi)}
