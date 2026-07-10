# Adversarial hunt — Observability / Insights

QA adversary bug hunt against the console observability/insights surfaces:
analytics rollups, traces, evals, drift, ROI/FinOps, lineage, audit/SIEM views.

Base: worktree off wave2 line (target 0fa1e38). READ-ONLY against live demo; all
mutation/attack probes are LOCAL tests / temp DB only. RED tests prove each break
(`.skip` + `// ADVERSARIAL` + GAPS ref; fail when un-skipped).

## Axes matrix

metric type × time window × org-scoping × data present/empty/huge × eval
pass/fail/error × drift state × role (viewer/writer).

## Ledger

| ID | Severity | Surface | Break | Root cause (file:line) | Status |
|----|----------|---------|-------|------------------------|--------|
| _(pending)_ | | | | | |

## Findings

_(in progress)_
