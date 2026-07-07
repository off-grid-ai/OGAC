# Observability

*Documented + verified 2026-07-07.* Surface: **Insights → Observability (`/observability`)**.

## What it is

The live picture of **how well your AI is actually doing** — not just at the moment you ran an eval,
but on real traffic, over time. It pulls together four things on one page: the **latest eval score**,
whether quality is **drifting**, the **online quality scores** streaming off live runs, and the full
**trace** of what happened inside any run. It's the "is it still good?" board.

## Why use it

- **Catch a regression before your users do.** A model swap, a prompt change, or a shifting data mix
  can quietly erode quality. Drift detection flags the erosion and (if you set an alert threshold)
  tells you the moment it crosses your line.
- **See quality on real traffic, live** — not just on the golden set you happened to run. Online
  scores keep grading live answers so the number on the board reflects what's happening now.
- **Debug a specific bad answer.** Every run leaves a trace you can expand to see each step it took
  and how long each took — so "why was this answer wrong/slow?" has a real, inspectable answer.
- **Set the alarm once.** Define a threshold ("tell me if pass-rate drops below X" or "if drift
  crosses Y") and the page raises a banner when it's breached — you don't have to keep watching.

## When to use it

- **Right after any change** — new model, edited prompt, new data source — watch the score and drift
  for a day or two.
- **On a schedule** — a glance each morning to confirm quality is holding.
- **When a run went wrong** — open its trace and walk the steps.
- **When you want to be told, not to watch** — set an alert threshold and a baseline.

## How to use it

Open **Observability**. It's a single scrolling board (no tabs to hunt through). Top to bottom:

- **The four status cards** — **Latest eval score**, **Drift status** (stable / warning / drift),
  **Online scoring** (whether live grading is on), and **Traced runs** (how many runs have a trace).
- **A drift banner** appears at the top if quality has actually drifted, quoting the reason.
- **Alert banners** appear for any threshold you've set that's now breached (with a warning /
  critical badge).
- **Eval score history** — the trend of your golden-set scores over time, newest on the right.
- **Drift & degradation** — the metrics behind the drift verdict (a distribution-shift measure and a
  mean-score-change measure), each with a stable / warning / drift status, plus how many samples the
  baseline and current windows hold.
- **Alert thresholds & baseline** — the one **interactive** block on the page (see below).
- **Quality insights over a window** — cost, tokens, run counts, and the score trend across a range
  you pick (**24h / 7d / 30d / 90d**), plus a **cost-by-model** breakdown.
- **Registry** (a small tabbed card: **prompts / datasets / sessions**) — a read-only view of what's
  been recorded.
- **Traces** — the list of run traces; expand one to see its step-by-step waterfall.
- **Eval runs** — golden-set runs; click one for the per-case breakdown.
- **Recent agent run traces** — every interaction through the governed pipeline, with its checks,
  grounding, and signed provenance; click through to the run.

### The one place you write here: alerts & baseline

Most of Observability is read-only *insight* — but the **Alert thresholds & baseline** block is a
full manage-it surface:

- **Add an alert rule** — pick the metric (**drift score** or **eval pass-rate**), an operator
  (greater/less than), a value (0–1), and a severity (**warning** / **critical**). Save it and a
  breach raises a banner at the top of the page.
- **Delete an alert rule** — remove one you no longer want.
- **Reset the baseline** — tell drift "today's behavior is the new normal" (with a note for the
  record). Do this deliberately after an intended change, so drift measures against the *new* correct
  behavior, not the old one.

There's also a **Run sweep** action (top-right) to kick a fresh QA pass on demand.

### Opening a run's trace

Two ways in: expand any row in the **Traces** card to see its span waterfall inline, or click a row
in **Recent agent run traces** to open that run's full detail. Either way you can follow the run by
its **run id**, which is the same id used across the [Audit Log](audit-logs.md), lineage, and the
signed provenance record — so one id ties a run to everything about it.

## How to check it's working

1. **The scores are real, not zeros.** After running an eval in [Evals](evals.md), the **Latest eval
   score** card and the **Eval score history** trend should update to reflect that run. If you run a
   couple of evals and the trend moves, the pipeline from eval → Observability is live.
2. **Drift computes.** The **Drift status** card and **Drift & degradation** table should show a real
   verdict (**stable**, with its two metrics and baseline-vs-current sample counts) rather than "not
   configured." *(Verified live 2026-07-07: drift returned **stable** with real metrics computed from
   the eval-score history.)*
3. **Traces flow.** The **Traces** card should list recent runs; expanding one should draw a waterfall
   of its steps. *(Verified live 2026-07-07: traces are being recorded and read back — real runs,
   including governed pipeline events, were present.)*
4. **Your alert fires.** Set a deliberately-easy threshold (e.g. pass-rate below 100%), and confirm
   the breach banner appears at the top — proof the alarm path is wired end-to-end. Then set it back
   to a sensible value.
5. **Spend adds up.** The windowed **quality insights** and **cost-by-model** should show non-zero
   cost/tokens once traffic has flowed. *(Verified live 2026-07-07: real spend and per-model cost
   were populated.)*

> **Honest note:** the deeper insight panels (windowed cost/score trend, the prompts/datasets/sessions
> registry, and trace read-back) depend on the trace backend being connected. On this deployment it
> **is** connected and returning data. If a future deployment hasn't wired it, those panels say so
> plainly ("read-back not configured") and render zeros rather than inventing numbers — the drift and
> eval-score signals still work regardless, because they're computed from your own run history.

## Related
- [Evals](evals.md) — where the golden-set scores that feed this board are defined and run.
- [Audit Log](audit-logs.md) — the accountability record; shares the run id with traces here.
- [Agent Runs & Jobs](agent-runs-jobs.md) — the run history a trace here links back to.
- [Services](services.md) — is a backing service actually up, when a signal looks empty?
