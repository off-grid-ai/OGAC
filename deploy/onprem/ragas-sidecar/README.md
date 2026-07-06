# RAGAS sidecar (on-prem)

A small FastAPI service that runs the real [ragas](https://github.com/explodinggradients/ragas)
RAG-evaluation metrics for the Off Grid Console's eval-runner. The console already expects it — when
`OFFGRID_RAGAS_URL` is set it POSTs datasets here; when it is unset or unreachable the console
degrades honestly to its first-party heuristic scorer. Deploying this is what turns `ragas`-engine
evals from "heuristic" into real ragas scores.

**Air-gap safe.** ragas's judge LLM and embeddings are pointed at the ON-PREM gateway URL passed in
each request. No external API (no `api.openai.com`) is ever contacted.

## Contract (frozen — matches `src/lib/eval-runner.ts` byte-for-byte)

`GET /health` → `200 { "status": "ok", "service": "ragas-sidecar" }`

`POST /evaluate`

```jsonc
// request body
{
  "model": "gemma-local",                 // OFFGRID_EVAL_MODEL — the judge/embeddings model id
  "gateway": "http://127.0.0.1:8800/v1", // ${GATEWAY_URL}/v1 — OpenAI-compatible base URL
  "dataset": [
    { "question": "...", "answer": "...", "contexts": ["..."], "ground_truth": "..." }
  ]
}
```

```jsonc
// response body — aggregate (mean) over the dataset, each score 0..1
{
  "metrics": {
    "faithfulness": 0.82,
    "answer_relevancy": 0.77,
    "context_precision": 0.90,
    "context_recall": 0.71,
    "answer_correctness": 0.68
  }
}
```

The console reads `data.metrics[def.metric]`. **Per-metric honesty:** if any single metric fails
(model can't do it, timeout, ragas internal error) that key is **omitted** from `metrics` rather
than failing the whole request — the console then degrades that one metric to its heuristic. An
empty dataset returns `{ "metrics": {} }`. The service does not 500 on evaluation failures.

## How the console consumes it

`src/lib/eval-runner.ts` → `ragasMetrics()`:

- Reads `OFFGRID_RAGAS_URL` (set to `http://127.0.0.1:8002` on S1 — see `.env.production`).
- POSTs `{ model, gateway: ${GATEWAY_URL}/v1, dataset }` with a 180s timeout, forwarding the
  gateway auth header (`x-api-key` or Keycloak Bearer) it uses for the gateway.
- On a non-2xx or network error it returns `null` and the eval is tagged `heuristic` — never fake.

## Build + run on S1

From `deploy/onprem/ragas-sidecar/` on S1 (or after rsync'ing this dir there):

```bash
# with docker compose (recommended — binds loopback + healthcheck + restart policy)
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml logs -f      # watch it come up
docker compose -f docker-compose.yml down         # stop

# or plain docker
docker build -t offgrid-ragas-sidecar:latest .
docker run -d --name offgrid-ragas --restart unless-stopped \
  -p 127.0.0.1:8002:8002 \
  --add-host host.docker.internal:host-gateway \
  -e OFFGRID_GATEWAY_API_KEY="$OFFGRID_GATEWAY_API_KEY" \
  offgrid-ragas-sidecar:latest
```

Verify:

```bash
curl -s http://127.0.0.1:8002/health
# {"status":"ok","service":"ragas-sidecar"}
```

The console is set to `OFFGRID_RAGAS_URL=http://127.0.0.1:8002` (loopback — the console runs
natively on the same host, so it reaches the port the container publishes on 127.0.0.1).

## Networking note — the `gateway` URL must be reachable from inside the container

The console builds the gateway URL from `OFFGRID_GATEWAY_URL`. **Inside the container `127.0.0.1`
is the container, not the host**, so if the console passed `http://127.0.0.1:8800/v1` ragas could
not reach the gateway. Two safe options on S1 (pick one):

1. Set the console's `OFFGRID_GATEWAY_URL=http://127.0.0.1:8800` (the LAN IP of S1) — then the
   `gateway` field the console sends resolves from inside the container as-is. This is the current
   on-prem setting (see `SERVICE_MAP.md`).
2. Or rely on the `host.docker.internal` host-mapping added in the compose/run command and set the
   console's gateway to `http://host.docker.internal:8800`.

## Auth

ragas's OpenAI-compatible clients send `Authorization: Bearer <api_key>`. `OFFGRID_GATEWAY_API_KEY`
(env) is forwarded as that key; the aggregator accepts a Bearer on `/v1`. If the aggregator uses a
different static key, set `OFFGRID_GATEWAY_API_KEY` in the environment before `up`.

## Files

- `app.py` — FastAPI service: `/health` + `POST /evaluate`, runs the five ragas metrics, per-metric
  degradation, gateway-wired LLM + embeddings.
- `requirements.txt` — pinned deps.
- `Dockerfile` — `python:3.11-slim`, uvicorn on `:8002`.
- `docker-compose.yml` — loopback bind `127.0.0.1:8002`, restart policy, healthcheck.
