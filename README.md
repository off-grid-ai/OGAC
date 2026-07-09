# Off Grid AI Console

# AWS for AI.

Every piece you need to run AI in a company already exists. A gateway to the models. Evals. Guardrails.
PII masking. Data pipelines. Audit. Lineage. Knowledge bases. The problem was never the parts. It was
wiring them into one thing that works, and keeping every team inside the rules.

AWS meant you stopped assembling servers. Off Grid AI means you stop assembling AI infrastructure.
It is one interface where all of it is already set up and connected. You define your organization's
rules, policies, guardrails, and knowledge once. Everyone builds on top of them. It just works.

```bash
git clone <this-repo> && cd console
make up          # the whole stack comes up, wired together
npm run dev      # http://localhost:3000
```

That is the setup. It just works. Run it on your own servers or in your cloud, your call.

---

## What it is

An open-source platform you run on your own servers that makes your enterprise intelligent.

It harnesses the data and context already inside your organization, and lets your people and their
agents put frontier models to work on it, to raise their productivity, output, and quality. Every
run is secure, reliable, compliant, and governed, without anyone wiring that up per app.

Non-technical people build the apps. They describe what they need in plain language and get back a
working, governed workflow, tested in a sandbox before it touches anything real.

## Set once, use everywhere

This is the part that changes how an enterprise runs AI.

An administrator defines the organization's rules, policies, guardrails, observability, data
lineage, and knowledge bases one time. From then on, every employee and every agent inherits them
automatically. Nobody re-implements governance. Nobody works around it. Nobody ships an app your
risk team has not already blessed.

## How it flows

```
   data  ->  gateway  ->  pipelines  ->  agents / apps  ->  compliance & regulations
 (your        (one         (evals,        (built by         (audited, cited,
  systems)     governed     drift,         non-technical      signed, reversible,
               model door)  guardrails,    people in          regulator-ready)
                            PII, policy)   plain language)
```

- **Data.** It connects to the databases, warehouses, and identity you already run. You change
  nothing about your stack.
- **Gateway.** One governed door to every model. Local by default. Cloud routing is opt-in and masks
  sensitive fields before a byte leaves the box.
- **Pipelines.** Bind a model, evals, a golden set, policy, guardrails, and drift to a use case once.
  Everything built on top inherits all of it.
- **Agents and apps.** The people who know the work build the workflow, in plain language, in a
  sandbox.
- **Compliance.** Every run is audited, every answer cited, every output signed. Export it and hand
  it to a regulator.

## Why it matters

An enterprise reaches its full potential by amplifying its own moat: its data, its people, its
processes, its reach. Off Grid AI lets it do that through one governed interface, so putting AI to
work is a thing anyone in the org can do inside the rules, not a project that waits on a platform
team. Real change reaches people through the enterprises that serve them. This is how those
enterprises get intelligent.

## Built on what you already trust

No proprietary runtime to learn. It composes engines your team already knows, each wrapped in
governance. Swap any of them with one environment variable.

| Layer | Engine |
|---|---|
| System of record, vectors | Postgres + pgvector |
| Identity / SSO | Keycloak |
| Durable orchestration | Temporal |
| Ingestion / ETL / DAG | Airbyte, dbt, Kestra |
| Warehouse + lineage | ClickHouse, Marquez |
| PII detection | Presidio |
| Secrets | OpenBao |
| Audit / traces | OpenSearch, Langfuse |
| Vector store | Qdrant or LanceDB |
| Object store | SeaweedFS |

## Run it

```bash
make up            # bring up the backing services (make data for just Postgres + storage)
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm test           # real tests, against a real database
```

To boot you need `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_KEYCLOAK_*` (see `.env.example`). Ship to
your own fleet with `./deploy/push.sh` after reading `deploy/DEPLOY.md`.

## When to use it

A data-sensitive or regulated enterprise that wants AI inside real operational workflows (claims,
underwriting, reconciliation, reporting), cannot send that data to a hosted AI, needs every step
auditable, and wants business teams to build these themselves. BFSI is the sharp case. It is not for
a public consumer chatbot or a throwaway prototype.

## License

Open source under AGPL-3.0. The entire platform. Nothing held back, nothing gated.

---

*Built by [Wednesday](https://wednesday.is). Developer guide: [`CLAUDE.md`](CLAUDE.md). Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md).*
