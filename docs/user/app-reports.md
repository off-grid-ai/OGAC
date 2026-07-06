# App reports — rollups across your runs

Status: ✅ fully documented (post-builder-epic sweep, 2026-07-06)

**What it is** — The Reports screen (`/apps/reports`) aggregates every run of your apps into
operational metrics, and each individual run can be exported as a **signed PDF**.

**Why use it** — To see whether a governed process is healthy: how many runs, how many completed vs
failed vs cancelled, how often a human approved vs rejected, how many exceptions, throughput per day,
average latency, and token/cost totals. The per-run signed PDF is your tamper-evident record of what
an app did on a given run.

**When to use it** — For weekly ops review, for cost tracking, and whenever you need an auditable
artifact of a specific run (a reimbursement decision, a triage outcome).

## What the rollups show

- **Outcomes** — completed / failed / cancelled / running / awaiting-review counts.
- **Human decisions** — approvals, rejections, and the approval rate.
- **Exceptions** — errored-step count and exception rate.
- **Throughput** — runs per day across the observed span.
- **Latency** — average wall-clock run duration.
- **Cost** — total tokens and total USD, pulled from run provenance and per-step detail.
- **Per-run summary** — steps, steps done/errored, human decisions, duration, tokens, cost.

## The signed per-run PDF

`GET /api/v1/admin/app-runs/[id]/report` renders one run to a PDF (pure-JS, no headless browser) and
signs it with a **detached ed25519 signature** (or HMAC fallback). The signature covers a manifest
(filename, format, generated-at, generator, SHA-256 of the bytes) and travels in `X-Provenance-*`
response headers, so the PDF is **offline-verifiable with only the public key**. This is the same
provenance machinery the platform uses elsewhere — it is real signing, not a stub.

## Caveat — the `report` output *sink* is not the report *export*

Do not confuse two things:
- The **report export route** above is real and produces a signed PDF on demand.
- A **`report` output sink** on a step (chosen in the builder) currently records *intent* only: at
  run time the step completes with a note that delivery is deferred — it does **not** auto-generate
  and deliver a PDF as part of the run. Use the export route to get the PDF. Tracked in
  `docs/GAPS_BACKLOG.md`.
