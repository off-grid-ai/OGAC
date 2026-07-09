# Off Grid AI Console (OGAC)

> Become an intelligent enterprise, without compromising.

## You are the bottleneck, and this fixes that

Every team wants AI in their workflow, and each request lands on you. Wire up the model. Prove it
won't leak data. Get risk and compliance to sign off. Keep it running. You end up as the one person
standing between an idea and a working system, shipping one-off integrations that never quite stop
being your problem.

Off Grid AI Console changes who does that work.

The people who understand the process, the underwriter, the tax analyst, the claims officer,
describe what they need in plain language and get back a working application. You set the guardrails
once. They build on top of them. You stop hand-wiring integrations and start running a platform.

All of it runs on infrastructure you own. Your data stays inside your walls. Cloud model routing is
there when you want it, but it masks sensitive data before anything leaves the box, and it stays off
until you turn it on.

## What you can do with it

**Put AI in the hands of non-technical staff without losing control.**
Someone on a business team writes: "when a reimbursement claim comes in, pull the employee's policy,
check it against the limit, and if it's over ₹40,000 send it to a manager to approve, then email the
outcome." They get a real multi-step application back. You never wrote it. It still runs inside every
control you defined.

**Ship AI that risk and compliance will sign off on.**
Governance runs where the work happens, not in a policy document. A model call that isn't allowed to
leave the box doesn't. A record with personal data is masked before it crosses any wire. Every run
is checked against the evaluations you set, and stopped when it fails one.

**Answer a regulator with evidence instead of a shrug.**
Every run is audited. Every answer traces back to the source it came from. Reports come out
citation-backed and ready to hand over.

**Connect it to the systems you already run.**
Point a use case at your existing databases and warehouses. A trigger arrives (a webhook, an email,
a scheduled job, a form), the run is governed from end to end, a person approves whatever needs
approving, and the result is delivered out. Nothing gets ripped and replaced.

**Show the business what it's worth.**
Each application reports hours saved, value returned, and model cost, in plain numbers you can put
in front of a budget owner.

## What's real today

Three enterprise tenants run from one deployment right now: a life insurer, a general insurer, and a
real-estate group, each with its own data, its own users, and its own modules. The whole loop works
end to end. Connect data, build an app in plain language, trigger it, approve a run, read the report.

We hold a hard honesty line. Work is reported in one of three states, written, wired, or verified
live, and nothing counts as done until it's verified. Where something isn't finished, it's in the
open: `docs/GAPS_BACKLOG.md` lists every known gap. Keeping many tenants fully isolated from each
other, on every single surface, is still in progress. Demo and single-tenant use are solid today.

The core is open source under AGPL-3.0. Run the entire platform with no account and nothing held
back. Free for organisations under 20 people; larger teams license from us.

## For developers

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # the real gate: typecheck and tests don't catch route/build errors
npm run typecheck
npm test
npm run coverage     # ≥85%, enforced by the pre-push hook
npm run smoke        # health-check each service
```

Bring up local infrastructure from `deploy/` (`make up` for the full stack, `make data` for
Postgres and object storage, `make secrets` for the vault). Runtime config lives in
`.env.local` / `.env.production` on the server, never in git. Deploy to the on-prem fleet with
`./deploy/push.sh` (read `deploy/DEPLOY.md` first).

How the code is meant to be written, and where the systems of record live, is in
[`CLAUDE.md`](CLAUDE.md) and [`docs/ENGINEERING.md`](docs/ENGINEERING.md). The roadmap is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

*AGPL-3.0-only. © Off Grid AI / Wednesday Solutions, Inc.*
