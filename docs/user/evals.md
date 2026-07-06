# Evals — quality gates & templates

Status: ✅ fully documented (post-builder-epic sweep, 2026-07-06). Surface: **Intelligence → Evals
(`/evals`)**.

## What it is

Evals measure the quality and safety of your AI outputs and turn a threshold into a pass/fail
**gate**. The surface has three parts:

- **Template catalog** — 12 prebuilt metrics you can apply in one click.
- **Saved eval definitions** — your applied templates, each with a metric, threshold, and direction;
  runnable, editable, deletable.
- **Golden sets & suites** — cases with expected outcomes, run through an evaluator (golden /
  promptfoo / ragas). Pass-rates roll up on the page and feed Observability.

## Why use it

- Prove quality before shipping an agent / prompt / model change; catch regressions with a gate.
- Red-team-style metrics (toxicity, bias, PII leakage, prompt-injection) surface safety failures.
- **The scores are honest** — see below.

## The 12 templates and their engines

Each template declares which engine it needs. `higher-better` metrics pass at/above the threshold;
`lower-better` metrics pass at/below it.

| Template | Engine | Direction |
|---|---|---|
| faithfulness | ragas | higher-better |
| answer_relevancy | ragas | higher-better |
| context_precision | ragas | higher-better |
| context_recall | ragas | higher-better |
| correctness | ragas | higher-better |
| toxicity | guardrails | lower-better |
| refusal | heuristic | higher-better |
| bias_detection | guardrails | lower-better |
| pii_leakage | presidio | lower-better |
| prompt_injection | heuristic | higher-better |
| summarization | heuristic | higher-better |
| sentiment | heuristic | higher-better |

## Honest scoring (no fabricated numbers)

The catalog shows each template's real availability:

- **ready** — the real engine (ragas / guardrails / presidio) is configured and will score it.
- **fallback** — the real engine isn't configured, so a deterministic **heuristic** scores it
  instead, and the result is tagged `heuristic` end-to-end (in the run record, the API, and the UI).
- **configure** — the engine is unavailable; the UI tells you the exact env var to set.

When a real engine isn't reachable, the runner **never fabricates a high score** — it either uses a
clearly-tagged heuristic approximation or, if answer generation itself fails, produces an honestly
low score. Every persisted result carries the engine that produced it, so a pass-rate is never
silently propped up by a missing evaluator.

## How to use it (full CRUD + run)

- **Apply a template** → creates a saved eval definition.
- **Run** a saved eval → returns per-metric scores tagged with the engine that computed each.
- **Edit / Delete** a saved eval.
- **Golden cases** — create / edit / delete cases; **Run** a suite (golden / promptfoo / ragas); the
  toast and table confirm which engine ran.

Results feed **Observability** (drift, LLM-as-judge, traces).
