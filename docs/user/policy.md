# Policy

*Documented + verified 2026-07-07.* Surface: **Governance → Policy (`/policy`)**.

## What it is

The rulebook that decides what the platform is allowed to do — who can reach which models,
where data of each sensitivity class may go, and what gets blocked outright. You write the rules
here as plain attribute conditions (and, for advanced cases, as policy code), the platform enforces
them on every run, and this page shows you the real allow/deny decisions coming back.

## Why use it

- Governance stops being tribal knowledge in someone's head and becomes **versioned rules the
  platform actually enforces** — the same rule that says "PII stays on-prem" is the one that runs.
- You can prove what's allowed and see what was blocked, so an audit is a page, not an archaeology dig.
- Change the rules of the road (routing, access, data class) in minutes, without a code deploy.

## When to use it

- You're changing what's permitted — e.g. keep confidential data on local models, block a data class,
  restrict a model to certain roles.
- A run was denied and you need to see **why** — the decision, the rule that fired, the input it saw.
- You're standing up a new environment and want proven governance from day one (start from a template).

## How to use it

The page opens on a status band, then the authoring area, then recent decisions.

### Read the engine status

The **Engine** card shows the active policy engine and whether it's **reachable** (green) or
**unreachable** (red). The **Active policy set** table lists every policy layer in force, with the
active one tagged. The first-party rules engine is **always on** — governance never silently turns
off. A second, advanced code-based engine appears here when it's wired.

### Author rules — three tabs

1. **ABAC rules (default)** — the everyday rulebook. Each row is priority · name · condition ·
   allow/deny · on-off.
   - **Add rule** opens a form: Name, Description, Attribute (e.g. `data_class`, `model`, `role`),
     Operator (equals / not-equals / contains / …), Value, Effect (allow or deny), Priority.
     Lower priority numbers win first; effect is deny-overrides.
   - Click a rule name to **edit** it; the trash icon **deletes** it (with a confirm dialog naming
     the rule); the per-row switch **enables/disables** it live.
   - Empty state reads *"No policy rules yet. Add one to start building…"*.
2. **Starter templates** — a searchable catalog grouped by intent (Data residency, Egress control,
   Model governance, Operations). Each card shows what it enforces; **Apply template** creates the
   rule for you. The toast reminds you to push it (below) to propagate.
3. **Rego modules (advanced)** — for complex authorization written as policy code. **New module**
   opens an inline editor (starter code pre-filled). **Validate** compiles it and tells you *"Rego
   compiles cleanly"* or lists the exact errors with locations. **Deploy** publishes it; the trash
   icon deletes it. If the code engine isn't reachable, this tab says so plainly and points you at
   the setting to enable it — the first-party rules still run in the meantime.

### Push the rules live

After adding or editing ABAC rules, click **Push / Reload** (top-right of the rules table). It
compiles the enabled rules and propagates them to the enforcement layer, and reports back how many
rules were pushed. This is the step that makes an edit take effect everywhere.

### Read recent decisions

The **Recent decisions** table shows real allow/deny evaluations: the decision (allow/deny badge),
the path, a summary of the input it judged, the engine, and the time. This is your "why was that
blocked" view — denies here correlate to runs in [Agent Runs](agent-runs-jobs.md) and the
[Audit Log](audit-logs.md).

## How to check it's working

- The **Engine** card badge reads **reachable** and the active engine is tagged in the policy-set
  table. If it reads **unreachable**, enforcement is degraded — fix that before trusting the page.
- After **Push / Reload**, the toast confirms the rule count that went live (e.g. *"pushed"* with a
  count). A new rule you added should be reflected in that count.
- **Recent decisions** is the honest end-to-end signal: run something that your rules should block
  (e.g. a restricted data class) and a matching **deny** row should appear. **If this table stays
  empty**, decisions aren't being streamed back to the console — the decision log source
  (`OFFGRID_OPA_DECISION_LOG_URL`) isn't configured. As of 2026-07-07 on the live fleet this table
  is empty for that reason (the first-party engine still *enforces* correctly — the empty table only
  means decisions aren't being mirrored here for read-back, not that policy is off).

See `docs/HOWTO.md` for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
