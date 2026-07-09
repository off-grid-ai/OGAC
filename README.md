# Off Grid AI Console

**An open-source platform you run on your own servers that lets non-technical staff build governed
AI apps on the systems you already have.**

Local models, your data, your infrastructure. A claims officer or a tax analyst describes a workflow
in plain English and gets back a working app. Every run is evaluated, guardrailed, audited, and
signed. No data leaves the building. No engineer in the loop.

## Why it exists

Every enterprise hits the same wall with AI. You can have it private, governed, or fast to build.
Pick two.

Off Grid AI gives all three:

- **Private.** The models run on your servers. Your data never leaves. Cloud routing is opt-in and
  masks sensitive fields before anything crosses the wire.
- **Governed.** Evals, drift, guardrails, and policy run on every request. Every output is audited,
  cited, and signed. Reversible, and provable to a regulator.
- **Fast to build.** The person who knows the process builds the app in plain language. It does not
  sit in the engineering queue.

## When to use it

Use it when a data-sensitive or regulated enterprise wants AI inside real operational workflows
(claims, underwriting, reconciliation, reporting) and:

- the data cannot go to a hosted AI,
- every step has to be auditable, and
- business teams should build these themselves, on the systems already in place.

BFSI is the sharp case. It is not for a public consumer chatbot or a throwaway prototype. The whole
point is control, governance, and self-hosting.

## What you get

- **It is a drop-in.** It connects to the databases, warehouses, and identity you already run. You
  change nothing about your stack.
- **Non-technical people build the apps.** They describe the workflow. They never touch code, infra,
  or a node canvas.
- **Nothing is tested on production.** Every app is built and run in a sandbox against your evals
  before it touches a live system.
- **You stay in control, and can prove it.** A call that is not allowed off the box does not leave.
  PII is masked. Every run is logged, scored, and stopped on a broken guardrail.
- **You read every line.** Open source, self-hosted. No hosted service holding your data, no black
  box, no phone-home.

## An example, start to finish

A claims officer writes:

> When a reimbursement claim comes in, pull the employee's policy, check it against the limit, and if
> it is over 40,000 rupees send it to a manager to approve, then email the outcome.

Off Grid AI turns that into a governed multi-step app: it reads the claim, pulls the policy from your
system, runs the check, pauses for a manager's approval, and emails the result. The claims officer
built it. Your data stayed put. Every step is on the audit trail. You were not paged.

## Built on what you already trust

No proprietary runtime to learn. It composes engines your team already knows, each wrapped in
governance:

| Layer | Engine |
|---|---|
| System of record, vectors | Postgres + pgvector |
| Identity / SSO | Keycloak (OIDC) |
| Durable orchestration | Temporal |
| Ingestion / ETL / DAG | Airbyte, dbt, Kestra |
| Warehouse + lineage | ClickHouse, Marquez |
| PII detection | Presidio |
| Secrets | OpenBao |
| Audit / traces | OpenSearch, Langfuse |
| Vector store | Qdrant or LanceDB |
| Object store | SeaweedFS |

Swap any of them with one environment variable. Nothing is welded in.

## Run it

```bash
git clone <this-repo> && cd console
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm test           # real tests, against a real database
```

Bring up the backing services from `deploy/`. `make up` for the full stack, `make data` for just
Postgres and object storage. To boot you need `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_KEYCLOAK_*`
(see `.env.example`). Ship to your own fleet with `./deploy/push.sh` after reading `deploy/DEPLOY.md`.

## How it is put together

```
   your data  ->  the gateway  ->  governed pipelines  ->  apps and agents  ->  the people who do the work
  (ingest +      (one governed     (evals, drift,           (built in plain     (a trigger arrives,
   transform)     model door)       guardrails, PII)         language)           it runs governed, result out)
```

A pipeline binds a model, evals, a golden set, policy, guardrails, and drift to a use case once.
Every app that consumes it inherits all of it. That is how a non-technical person builds something
your compliance team will sign off on. Business logic is pure and unit-tested, handlers are thin,
every backend sits behind a swappable adapter. The rules are in [`docs/ENGINEERING.md`](docs/ENGINEERING.md).

## License

Open source under AGPL-3.0. The entire platform. Nothing held back, nothing gated.

---

*Built by [Wednesday](https://wednesday.is). Developer guide: [`CLAUDE.md`](CLAUDE.md). Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md).*
