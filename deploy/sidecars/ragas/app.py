"""Ragas / RAG-metrics sidecar for Off Grid Console.

Apache-2.0 service wrapping Ragas behind the contract the console's `ragas` evals adapter calls
(src/lib/adapters/evals.ts):

    POST /evaluate   { "gateway": "http://host:7878/v1", "model": "gemma-local",
                       "dataset": [ { "question", "answer", "contexts": [..], "ground_truth" } ] }
      -> { "passed": int, "total": int, "metrics": { "faithfulness": float, ... } }

Ragas is LLM-based, so it runs entirely through OUR gateway (OpenAI-compatible) — both the judge LLM
and the embeddings — keeping it on-device and dependency-light (no torch). The console assembles the
dataset (it has the Brain for contexts and the gateway for answers) and ships it here; this service
only scores it. If Ragas can't run a metric (e.g. the model is unavailable) the request fails and
the console falls back to the golden set.
"""

from __future__ import annotations

from typing import List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Off Grid — Ragas sidecar")

PASS_THRESHOLD = 0.7


class Sample(BaseModel):
    question: str
    answer: str
    contexts: List[str] = []
    ground_truth: str = ""


class EvalRequest(BaseModel):
    gateway: str
    model: str = "gemma-local"
    dataset: List[Sample]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ragas"}


@app.post("/evaluate")
def evaluate(req: EvalRequest) -> dict:
    if not req.dataset:
        return {"passed": 0, "total": 0, "metrics": {}}
    try:
        from datasets import Dataset
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
        from ragas import evaluate as ragas_evaluate
        from ragas.metrics import answer_relevancy, context_recall, faithfulness
    except Exception as e:  # pragma: no cover - import guard
        raise HTTPException(status_code=500, detail=f"ragas not installed: {e}")

    # Point Ragas's LLM + embeddings at our gateway (OpenAI-compatible, on-device).
    llm = ChatOpenAI(model=req.model, base_url=req.gateway, api_key="offgrid-local", temperature=0)
    emb = OpenAIEmbeddings(base_url=req.gateway, api_key="offgrid-local")

    rows = {
        "question": [s.question for s in req.dataset],
        "answer": [s.answer for s in req.dataset],
        "contexts": [s.contexts or [""] for s in req.dataset],
        "ground_truth": [s.ground_truth for s in req.dataset],
    }
    ds = Dataset.from_dict(rows)
    metrics = [faithfulness, answer_relevancy, context_recall]
    try:
        result = ragas_evaluate(ds, metrics=metrics, llm=llm, embeddings=emb)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ragas evaluation failed: {e}")

    scores = result.to_pandas()
    faith = scores["faithfulness"].fillna(0).tolist()
    passed = sum(1 for v in faith if v >= PASS_THRESHOLD)
    agg = {m.name: round(float(scores[m.name].fillna(0).mean()), 3) for m in metrics}
    return {"passed": passed, "total": len(req.dataset), "metrics": agg}
