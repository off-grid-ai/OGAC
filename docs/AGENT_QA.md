# Agent QA — are the agents still doing a good job?

Shipping an agent is the start, not the finish. Models drift, prompts rot, retrieval degrades, and
a system that was correct last month can quietly get worse. **Agent QA** is the capability that
answers, on one surface, *"are the agents still performing properly — and if not, which one
regressed and when?"*

It is not one tool. It is **three lanes**, each a swappable capability port (first-party default +
OSS swap-in, selected by an env var, with graceful fallback):

| Lane | Question | First-party default (live) | OSS swap-in |
|------|----------|----------------------------|-------------|
| **Offline evals** | Does it pass our test set / golden cases? | `golden` — recall over the Brain | `promptfoo` (assertion matrix, CLI) · `ragas` (RAG metrics, sidecar) |
| **Online scoring** | Is live traffic still high-quality? | LLM-as-judge → **Langfuse** scores | (Langfuse is the score store) |
| **Drift / degradation** | Has behaviour shifted or quality dropped? | `native` — PSI + mean-degradation over eval history | `evidently` (drift test suites) |

The score trend over time *is* the degradation signal: a falling Langfuse quality score or a rising
PSI is the alarm.

---

## 1. Offline evals — `OFFGRID_ADAPTER_EVALS`

Run a scored evaluation through the active adapter:

```
POST /api/v1/admin/evals/run    →  EvalRunResult { engine, score, total, passed, startedAt }
```

- **`golden`** (default, always on) — a golden set of `query → expected source` run against the
  Brain's retrieval, scored as recall. Edit cases in the console or via `/admin/golden-cases`.
- **`promptfoo`** — runs an assertion matrix via the promptfoo CLI against the gateway. Activates
  when the `promptfoo` binary is on `PATH` (or set `OFFGRID_PROMPTFOO_BIN`). Falls back to golden.
- **`ragas`** — RAG metrics (faithfulness, answer relevancy, context recall) via the **bundled
  Ragas sidecar** (`make qa`, `OFFGRID_RAGAS_URL`). The console assembles the dataset (Brain
  contexts + gateway answers + golden ground-truth); the sidecar scores it through the gateway.
  Falls back to golden if the sidecar/model is unavailable.

## 2. Online scoring — Langfuse

```
POST /api/v1/admin/qa/score   { input, output, sources?, traceId?, name? }
   →  ScoreResult { traceId, verdict {quality, faithfulness, reasoning}, judged, posted }
```

An **LLM-as-judge** (run through the gateway, no external model) scores each interaction's
**quality** and **faithfulness**, then writes both to **Langfuse** via its ingestion API, where they
trend per trace / user / project. Gated by the `online-evals` feature flag (so the flags port — and
Unleash, when active — governs it). Degrades gracefully: `judged:false` if the gateway is
unreachable (no fabricated score is written), `posted:false` if Langfuse is down.

Configure: `OFFGRID_LANGFUSE_URL` + `OFFGRID_LANGFUSE_AUTH` (base64 `public:secret`).

## 3. Drift & degradation — `OFFGRID_ADAPTER_DRIFT`

```
GET /api/v1/admin/qa/drift    →  DriftReport { engine, status, metrics[], baseline, current, note }
```

- **`native`** (default, always on) — splits the eval-score history into a baseline window and a
  recent window and computes **Population Stability Index** (distribution shift) and
  **mean-degradation** (quality drop). Status is `stable | warning | drift`. Needs ≥4 eval runs.
- **`evidently`** — real Evidently `DataDriftPreset` over the baseline vs current windows, via the
  **bundled Evidently sidecar** (`make qa`, `OFFGRID_EVIDENTLY_URL`). Falls back to native PSI.

## One-call summary

```
GET /api/v1/admin/qa/status
   →  { offline: { engine, latestScore, recent[] }, drift: DriftReport, online: { configured, enabled } }
```

This is the endpoint a dashboard or monitor polls.

---

## What is live vs needs a service up

- **Live by default, no extra service:** golden evals, native PSI drift/degradation.
- **Bundled — bring up the `qa` profile (`make qa`):** Ragas sidecar (`:8002`), Evidently sidecar
  (`:8001`). Both fall back to the first-party default if down.
- **Live when their service is up:** online scoring (needs Langfuse + a loaded gateway model),
  promptfoo (needs the CLI).

## Verify it

```
# bring up the services you want to exercise, then:
make test-integrations
```

`scripts/test-integrations.sh` API-tests every wired integration end to end — the console QA routes
(via `OFFGRID_ADMIN_TOKEN`) and the underlying OSS service APIs (Langfuse score round-trip, etc.).
A service that's down is reported SKIP, not FAIL.
