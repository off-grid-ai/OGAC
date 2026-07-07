# AI Gateway & Model Routing

*Documented + verified 2026-07-07.* Surfaces: **Gateway & Fleet → AI Gateway (`/gateway`)** for the
live model pool and per-node control; **Governance → Control (`/control`)** for the routing rules
that decide where each request runs.

## What it is

One endpoint for every AI request your platform makes, and the rules that decide **where each
request is answered** — on one of your own machines, or (only when you allow it) an outside model.
It's how "this data must never leave the building" stops being a policy on paper and becomes what
actually happens to every prompt.

Two things live here:

- **Routing rules** (on the **Control** page) — plain if-this-then-there rules: *PII → stays on our
  own machines*, *public marketing copy → may use an outside model*, *restricted → refuse it
  entirely*. The first matching rule wins; if none match, the request stays local.
- **The model pool** (on the **AI Gateway** page) — the machines that actually answer local requests,
  each running a model, with live health. This is where you swap the model on a machine, restart it,
  or pull it out of rotation.

## Why use it

- **Data residency you can prove.** A request tagged as sensitive is answered on your own hardware —
  the prompt never leaves. You set that as a rule once and every request obeys it.
- **Spend where it's safe, save where it's not.** Let low-risk, public work burst to a cheaper or
  stronger outside model while everything sensitive stays home — one board, one set of rules.
- **A hard "no" for the data that must never move.** A *block* rule refuses the request outright
  rather than quietly sending it somewhere.
- **Cloud is leashed.** Even a rule that says "may use an outside model" is overridden the moment the
  org-wide egress switch is off — a cloud decision with egress off becomes a **block**. You can't
  accidentally leak by mis-writing one rule.
- **Keep the answers flowing.** If one machine is slow or jammed, the gateway routes around it to a
  healthy one; you watch and manage that pool here.

## When to use it

- A new class of data or a new task appears and you need to say where it's allowed to run → **add a
  routing rule**.
- You want to confirm what *would* happen to a given request before it happens → **test a rule** with
  the evaluator.
- A machine in the pool is misbehaving, you're rolling out a new model, or you're taking a machine
  down for maintenance → **swap / restart / disable a node** on the Gateway page.
- You're onboarding and want to see, at a glance, which machines are serving which models and whether
  they're healthy → the **AI Gateway** overview.

## How to use it

### Routing rules (Governance → Control)

Open **Control**. The **Model routing** card lists your rules in priority order. Each row shows the
priority number, the rule name, its condition (`attribute operator value`), the route
(**local** / **cloud** / **block**), the target model + fallback, and an on/off toggle.

> The rule of the road, printed on the card: *"For each request, the first matching rule (lowest
> priority number) decides where it runs. No rule matches → runs locally."*

**Add a rule.** Click **Add rule**. The form asks for:

- **Name** — a human label (e.g. "PII stays on-prem").
- **Attribute** — what to match on: `data_class`, `task`, `cost`, `region`, etc.
- **Operator** — `equals`, `not equals`, or `in` (a comma-separated list).
- **Equals / value** — what to match (e.g. `pii`, `longcontext`, `low`).
- **Route to** — **local** (on your own machines, data stays on the box), **cloud** (an outside model
  — *only if org egress is ON*), or **block** (refuse the request).
- **Model** (optional) — pin a specific model, with an optional fallback.

Save and the rule appears in the table at its priority. **Lower priority number = evaluated first.**

**Edit / disable / delete.** Flip the **on** toggle to disable a rule without deleting it; use the
trash icon to remove it (you'll confirm). The four seeded starter rules — *PII stays on-prem*,
*Confidential stays on-prem*, *Restricted data blocked*, *Public may burst to cloud* — are ordinary
rules you can edit or replace.

**The egress leash.** The card shows **Cloud egress: ON** or **OFF — cloud rules forced to block**.
When it's off, every `cloud` rule behaves as `block`, no exceptions. This is the master safety valve.

**Test a rule before you trust it.** Use **Evaluate**: type the request's attributes as
`key=value` pairs (e.g. `data_class=pii task=chat`) and the console shows the **effective action**,
**which rule matched**, and **why** — including whether the egress leash flipped a cloud decision to
block. Test the sensitive cases first.

### The model pool (Gateway & Fleet → AI Gateway)

Open **AI Gateway**. The top card shows the gateway is connected and its single endpoint; the
**Overview** tab shows what the platform can do (text, vision, embeddings, transcription, speech) and
the pool of machines ("nodes"), each with its model and a health dot (**up** / **degraded** /
**down**). Other tabs: **Traffic** (live request stats), **Logs** (recent requests), **Control**
(per-node actions), **Tuning** (read-only engine settings), **API keys**, **Tokens**, **Settings**.

**Per-node control** (Control tab, admin only). For each machine:

- **Swap model** — load a different installed model on that node. You'll confirm: *in-flight requests
  on this node drop while it restarts.*
- **Restart** — restart that node's model server (also drops in-flight requests on it).
- **Enable / Disable** — add or remove the node from rotation. Disabling asks you to confirm; traffic
  drains to the other nodes.

These are **honest about what's actually supported**. If the underlying cluster doesn't implement an
action, the console reports **Not actionable** (rather than faking success); if a node is unreachable
you get a clear error, never a silent no-op. Successful node actions are written to the Audit Log
(`gateway.node.model` / `.restart` / `.enable` / `.disable`).

## How to check it's working

You want three real, in-product signals — not a log tail.

1. **A live pool that's answering.** On **AI Gateway → Overview**, the nodes should show green **up**
   dots with a model on each. Then open **Chat**, send a message, and watch it come back — that
   answer was served by one of these nodes. The **Traffic** tab ticks up with that request. *(Live
   check on 2026-07-07: six nodes reported **up**, serving Qwythos-9B, Gemma-4-E4B, and Qwen3-VL-8B;
   real traffic and per-model request counts were flowing.)*

2. **A rule that actually bites.** Add or keep the *PII stays on-prem* rule, then open **Evaluate**
   and test `data_class=pii` — the effective action must come back **local**, matched to that rule.
   Test `data_class=public` with egress **off** and confirm it comes back **block** (the leash). If
   the evaluator's answer matches your intent, the rule is live. *(Verified: the four seeded rules
   returned correctly, PII → local, restricted → block.)*

3. **A node action that takes.** Swap or restart a node from the Control tab, then re-open Overview:
   the node's active model / health should reflect what you did, and the action should appear in the
   **Audit Log** as `gateway.node.*`. If instead you see **Not actionable**, that's the honest signal
   the cluster didn't accept it — nothing silently pretended to succeed.

If the top card ever reads not-connected, or the pool is empty, the gateway itself is the problem —
check its state on the [Services](services.md) board, which shares the same honest health probe.

## Related
- [Services](services.md) — is the gateway (and everything else) actually up?
- [Fleet](fleet.md) — the broader machine/device fleet and its controls.
- [Observability](observability.md) — traffic, spend, and quality once requests are flowing.
- [Policy](policy.md) & [Guardrails](guardrails.md) — the rest of the governed pipeline a routed
  request passes through.
