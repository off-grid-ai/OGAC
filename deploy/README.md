# Off Grid Console — runnable OSS stack

Brings up the **real** permissive OSS the console integrates with, so every integration is
testable end-to-end (not stubbed). Profiles map to capabilities — **bring up only what you've
licensed**, which mirrors how the product is sold.

The **Off Grid AI Gateway** (inference, embeddings, grounding-NLI, multimodal) is first-party and
runs **separately** on `127.0.0.1:7878` — deliberately not in this compose.

## Quickstart

```bash
cd deploy
make config            # validate
make up                # full stack   (or: make data | make secrets | make observability)
make smoke             # hit each service's health endpoint
```

Then copy the relevant lines from `.env.example` into `../.env.local` and restart the console.
Flipping an adapter to its real backend is one env var:

| Capability      | Env to activate                        | Service (compose)                            | License    |
| --------------- | -------------------------------------- | -------------------------------------------- | ---------- |
| `secrets`       | `OFFGRID_ADAPTER_SECRETS=openbao`      | OpenBao :8200                                | MPL-2.0    |
| `observability` | `OFFGRID_ADAPTER_OBSERVABILITY=signoz` | OTel Collector :4318 → VictoriaMetrics :8428 | Apache-2.0 |
| `data`          | `DATABASE_URL=…@127.0.0.1:5432/…`      | Postgres :5432                               | PostgreSQL |

Verify the wiring from the console once the stack is up:

```bash
# Secrets: write to OpenBao, read it back through the console's secrets adapter (indirectly).
curl -s -H "X-Vault-Token: offgrid-dev-token" -X POST \
  http://127.0.0.1:8200/v1/secret/data/demo -d '{"data":{"value":"hello"}}'

# Observability: trigger any audited action, then confirm the collector received OTLP.
docker compose logs otel-collector | grep offgrid-console
```

## Profiles → capabilities

- `data` — Postgres (console state + audit).
- `secrets` — OpenBao (KV v2; `secret/data/<key>` → `.value`).
- `observability` — OTel Collector (OTLP in) → VictoriaMetrics (metrics) + VictoriaLogs.
- `all` — everything.

All images are permissive-licensed (see `../LICENSES.md`). Helm charts for k8s come later.
