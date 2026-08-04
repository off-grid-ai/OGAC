# Does the non-technical person get the value of what we built?

**Goal:** every capability on `/operations/services/capability-map` must deliver value to a
non-technical department person — with desktop UX worth the name — not merely exist.

Measured live against the map on **2026-08-04**, not estimated.

---

## The measurement

`SERVICE_CAPABILITY_AUDITS`: **49 services, 196 capability items, 90 distinct destination surfaces.**

Each capability item declares the console surface where a person reaches it. Grouped by that surface:

| | services | items |
| --- | --- | --- |
| **Pure infrastructure** — every capability only on an `/operations/*` page | 17 | 57 |
| **Mixed** — some capabilities on a product surface, some only on `/operations/*` | 10 | 45 |
| **Product surfaces only** | 22 | 94 |

**The finding that matters: only 3 of the 50 non-operations surfaces sit inside the non-technical
person's world** — `/solutions/apps`, `/workspace/chat`, `/work/files`. Everything else lands in
operator IA: `/data/*`, `/governance/*`, `/runtime/*`, `/insights/*`.

## What that does and does not mean

It is **not** an instruction to expose 94 capabilities to a department person. Ninety-four links would
be a worse product, and the 17 pure-infrastructure services (PostgreSQL, Redis, Jaeger, the OTel
collector, the forwarders, the tunnel, device management) are **correctly invisible** — a claims handler
should never meet them. Counting them as gaps would be theatre.

The founder's model is the test:

> the system … inherit[s] the org's rules, workflows, data, connectors, policies, and guardrails
> **automatically**, and hand[s] them their own lovable ecosystem

So the bar is: **for each capability cluster, does its value appear inside the app or work surface, in
outcome language, without the person ever opening the operator page?**

## Cluster by cluster, against that bar

| Capability cluster (items) | Does its value reach the app surface? |
| --- | --- |
| Quality / evaluators / golden cases (13) | **Yes** — the app's Quality tab: checks, real cases it decided, what else is watching it |
| Usage dashboards / throughput (4) | **Yes** — `AppOwnerDashboard` (2026-08-04): volume, decisions, where the time goes |
| Access / RBAC / ABAC (5) | **Yes** — the app's Access tab, plus the owner banner naming an owner who never signs in |
| Guardrails / masking / recognizers (9) | **Partly** — the run trail says "passed a safety check"; there is no per-app "what protects this" panel |
| Data sources / connectors (15) | **Partly** — the app's steps name what they read, and the source-health warning now appears on the deployed app too (2026-08-04) |
| Knowledge indexes / retrieval (8) | **Partly** — reached through the app's steps, never summarised as "what this app knows" |
| Drift monitoring (7) | **No** — per-app drift is impossible: `drift_runs` carries only `org_id` + `dataset`, no app key |
| Model routing / where it ran (7) | **No, and not buildable today** — the ledger records a model name and nothing about where it ran. See below. |
| Lineage (4) | **No** — no per-app "where this data came from" |
| Replication / ETL / orchestration (15) | **Correctly operator-only** — a department person does not run pipelines |
| SIEM / audit / posture (6+) | **Correctly operator-only** |

## Refused rather than faked

Two panels a reader would obviously want, that would have to be invented:

- **"Where did this app's data go — did anything leave the building?"** This is the product's core claim
  and it is the one an owner would most value. The ledger records **a model name (4 distinct) and nothing
  about where that model ran** — no provider, no host, no region, no per-run egress event. A panel here
  would be an assertion dressed as evidence. It needs the recording first (ranked #1 in
  `WHATS_MISSING_2.md`), not a UI.
- **Per-app drift.** `drift_runs` has no app key. A per-app drift panel would be silently always-empty or
  silently org-wide.

## Closed on 2026-08-04

- The **job-shaped app's front door** — it led with a decision queue that could never hold anything,
  offered no way to run the app its own headline told you to run, and never showed what it produced.
- The **app owner's dashboard** — throughput, what it decided, where the time goes, whether its answers
  hold up. No cost panel, because there is no per-run cost and a fabricated ₹0.00 reads as "free".
- **The home screen leads with the reader's own work.** Fourteen cases were waiting, oldest eleven days,
  and the only trace above the fold was a sidebar badge under a headline about running the platform.
- **The source-health warning reaches the deployed app**, not just the console page — the team using the
  app were the one group never told it is working from nothing.
- **Language:** swept the app and work surfaces for engine names (OpenSearch, Langfuse, Evidently, Ragas,
  LLM Guard, Presidio, Keycloak, OpenBao, Kestra, ClickHouse) — **zero leaks**. Removed "every run goes
  through the governed pipeline" and a raw internal status printed as `Finished with status "done"`.
- **A refusal stopped reading as breakage** — the case picker showed "Could not look up cases · Try
  again" to anonymous readers of a public app, with a retry that could never succeed.

## Next, in value order

1. **Per-run egress record**, then the panel — turns the core claim from assertion into evidence.
2. **"What protects this app"** — one plain-language panel from the app's own declared checks and masking
   rules. Buildable today from the app spec.
3. **"What this app knows"** — the knowledge/domains it reads, summarised, instead of only inside steps.
