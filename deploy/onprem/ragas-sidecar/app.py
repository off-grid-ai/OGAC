"""Off Grid — RAGAS sidecar (on-prem, air-gap-safe).

FastAPI microservice the console's eval-runner already calls (src/lib/eval-runner.ts). It runs the
REAL ragas library metrics over a dataset the console assembles, and wires ragas's judge LLM +
embeddings to the ON-PREM gateway passed in the request — never api.openai.com, never any external
API. Only the gateway URL in the request body is contacted.

CONTRACT (byte-for-byte, do NOT change — the console side is deployed + frozen):

    POST /evaluate
      request  { "model":   "<eval model id>",
                 "gateway": "<GATEWAY_URL>/v1",     # OpenAI-compatible base URL
                 "dataset": [ { "question", "answer", "contexts": [..], "ground_truth" } ] }
      response { "metrics": { "faithfulness": 0..1, "answer_relevancy": 0..1,
                              "context_precision": 0..1, "context_recall": 0..1,
                              "answer_correctness": 0..1 } }      # aggregate over the dataset

    GET /health -> 200 { "status": "ok", ... }

HONESTY / DEGRADATION: each metric is computed independently. If a single metric fails (model can't
do it, timeout, ragas internal error) that metric is OMITTED from `metrics` rather than 500-ing the
whole request — the console then degrades that metric to its first-party heuristic honestly. Only a
malformed request (bad JSON / missing fields) or ragas-not-installed is an error.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ragas-sidecar")

app = FastAPI(title="Off Grid — RAGAS sidecar")

# The console authenticates the gateway with EITHER a Keycloak Bearer or a static x-api-key. ragas's
# OpenAI-compatible clients only speak `api_key` (sent as `Authorization: Bearer`), so we forward one
# key to the gateway. Prefer an explicitly-provisioned key; the aggregator accepts a Bearer on /v1.
GATEWAY_API_KEY = os.environ.get("OFFGRID_GATEWAY_API_KEY", "offgrid-local")

# The exact five metrics the console's RAGAS_METRICS set expects, in the console's order.
METRIC_ORDER = [
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
    "answer_correctness",
]


class Sample(BaseModel):
    question: str
    answer: str = ""
    contexts: List[str] = []
    ground_truth: str = ""


class EvalRequest(BaseModel):
    # `gateway` is the OpenAI-compatible base URL (already includes /v1) the console passes.
    gateway: str
    model: str = "gemma-local"
    dataset: List[Sample] = []


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ragas-sidecar"}


def _build_metrics():
    """Import ragas + build the metric objects. Raises if ragas isn't installed."""
    from ragas.metrics import (
        answer_correctness,
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )

    return {
        "faithfulness": faithfulness,
        "answer_relevancy": answer_relevancy,
        "context_precision": context_precision,
        "context_recall": context_recall,
        "answer_correctness": answer_correctness,
    }


def _score_metric(metric_name, metric_obj, dataset, llm, emb) -> Optional[float]:
    """Run ONE ragas metric over the whole dataset and return its aggregate mean in 0..1.

    Returns None on any failure so the caller can omit the metric (honest degradation) — a single
    bad metric never fails the whole request.
    """
    try:
        from datasets import Dataset
        from ragas import evaluate as ragas_evaluate

        rows = {
            # ragas expects a non-empty contexts list per row; fall back to [""] so it doesn't throw.
            "question": [s.question for s in dataset],
            "answer": [s.answer for s in dataset],
            "contexts": [s.contexts or [""] for s in dataset],
            "ground_truth": [s.ground_truth for s in dataset],
        }
        ds = Dataset.from_dict(rows)
        result = ragas_evaluate(ds, metrics=[metric_obj], llm=llm, embeddings=emb)
        frame = result.to_pandas()
        if metric_name not in frame.columns:
            log.warning("metric %s produced no column; omitting", metric_name)
            return None
        mean = float(frame[metric_name].fillna(0).mean())
        # Clamp defensively into 0..1 — the console contract is a normalized score.
        return max(0.0, min(1.0, round(mean, 4)))
    except Exception as e:  # noqa: BLE001 — degrade this metric, keep the rest
        log.warning("metric %s failed, omitting: %s", metric_name, e)
        return None


@app.post("/evaluate")
def evaluate(req: EvalRequest) -> dict:
    if not req.dataset:
        return {"metrics": {}}

    try:
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
    except Exception as e:  # pragma: no cover - import guard
        log.error("langchain-openai not installed: %s", e)
        return {"metrics": {}}

    try:
        metric_objs = _build_metrics()
    except Exception as e:  # pragma: no cover - import guard
        log.error("ragas not installed: %s", e)
        return {"metrics": {}}

    # Point ragas's judge LLM + embeddings at the ON-PREM gateway. `base_url` is the request's
    # `gateway` (OpenAI-compatible, already /v1). No external host is ever contacted.
    base_url = req.gateway
    llm = ChatOpenAI(
        model=req.model,
        base_url=base_url,
        api_key=GATEWAY_API_KEY,
        temperature=0,
    )
    emb = OpenAIEmbeddings(
        model=req.model,
        base_url=base_url,
        api_key=GATEWAY_API_KEY,
    )

    metrics: Dict[str, float] = {}
    for name in METRIC_ORDER:
        obj = metric_objs.get(name)
        if obj is None:
            continue
        score = _score_metric(name, obj, req.dataset, llm, emb)
        if score is not None:
            metrics[name] = score

    return {"metrics": metrics}
