# Data domains — declaring where your data lives

Status: ✅ fully documented (post-builder-epic sweep, 2026-07-06)

**What it is** — A data domain is a named declaration: *"reimbursement quota lives in connector
`con_hr`, table `employee_quota`"*, *"invoices live in this S3 bucket"*. It maps a human phrase (a
label plus optional aliases) to exactly one connector and one resource. Manage them at
**Data → Data domains** (`/data-domains`).

**Why use it** — When an app step says *"check the employee's quota"*, the platform must route to
the *correct* system. It does this **by rule, never by guessing** — a wrong bind would silently read
the wrong system, which is a data-integrity incident. Declaring domains is what makes the builder
able to wire a connector-query step at all: no declaration → no binding → an honest gap.

**When to use it** — Before (or while) building any app that reads your systems. Declare a domain
for each real data source a process needs.

## How the matcher works (deterministic, no-guess)

A phrase resolves to a domain by strongest-signal-first: exact label match → exact alias match →
substring overlap → token-set containment. It resolves only when there is a single clear winner:

- An **exact** label/alias hit binds — unless two distinct domains match exactly (genuine ambiguity
  → binds to nothing).
- A **fuzzy** hit binds only if it clears a confidence floor *and* beats the runner-up by a clear
  margin. Two near-equal candidates → binds to nothing.
- Anything below that → **null** (the builder shows a gap; a run step errors as "unbound — not
  guessed").

Plurals are normalized ("invoices" ≡ "invoice", "policies" ≡ "policy"), so you don't need an alias
for each plural.

## How to manage domains (full CRUD)

At `/data-domains`:

- **Create** — give it a label (e.g. "Reimbursement quota"), any aliases ("quota", "employee
  quota"), pick the connector, and name the resource (table / bucket / path). Optional op-hints
  (e.g. a default row limit).
- **Read** — the list shows each domain, its connector binding, and its resource.
- **Update** — relabel, add aliases, or rebind to a different connector/resource.
- **Delete** — remove a domain (apps that referenced it will show that step as unbound again).

Every create/update/delete is written to the audit log.

## Tips

- **Add aliases generously.** The more surface forms a domain answers to, the more reliably the
  builder wires the step from natural language.
- **Only fully-bound domains are usable.** A domain missing a connector or resource can't ground a
  connector-query — it's ignored by the builder until completed.
- **A miss is safe; a wrong bind is not.** If the builder won't wire a step, add a clearer label or
  alias rather than forcing it — the no-guess behavior is protecting you.
