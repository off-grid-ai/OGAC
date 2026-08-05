# Live proof — the gateway fails over past a dead deployment

**Date:** 2026-08-05 · **Box:** on-prem (S1) · **Proxy:** LiteLLM at `127.0.0.1:4000`, DB-backed

The gate said *"Generated config enables routing policy, but no live multi-node failure drill proves
failover on the production path."* Correct — and the reason it had never been proven is worth stating:
**every model on this deployment has exactly ONE deployment**, so there was nothing to fail over to.

```
total deployments: 3
  onprem/qwen3-vl-8b  -> 1
  onprem/gemma-4-e4b  -> 1
  onprem/qwythos-9b   -> 1
```

## The drill

Added a second deployment under an existing model name pointing at a port with nothing behind it, via
the runtime `POST /model/new` (DB-backed, so no config file was touched and the change is reversible):

```
deployments under onprem/qwythos-9b: 2
  id= b0bf6a43…9e6e5          (the real one)
  id= failover-drill-dead     (api_base http://127.0.0.1:7899/v1 — nothing listening)
```

## The first attempt was INVALID, and the reason matters

Six identical prompts all returned 200 — including one reporting `x-litellm-model-id:
failover-drill-dead` with `attempted-retries: 0`. A dead endpoint cannot answer, so that result was
impossible on its face: **response caching is enabled on this proxy**, and six identical prompts were
served from Redis. The drill measured the cache, not the router.

Recording this because a green drill that proves nothing is worse than no drill — it would have gone
into the ledger as evidence. A load-balancing drill on a cached proxy must defeat the cache or it is
measuring the wrong component.

## The real drill — unique prompt per request, `cache: {"no-cache": true}`

```
req 1 -> HTTP 000 | served-by=none                | retries=?
req 2 -> HTTP 200 | served-by=b0bf6a43…9e6e5      | retries=0
req 3 -> HTTP 200 | served-by=b0bf6a43…9e6e5      | retries=2
req 4 -> HTTP 200 | served-by=b0bf6a43…9e6e5      | retries=1
req 5 -> HTTP 200 | served-by=b0bf6a43…9e6e5      | retries=1
req 6 -> HTTP 200 | served-by=b0bf6a43…9e6e5      | retries=0
SUCCEEDED=5 FAILED=1
```

**Requests 3, 4 and 5 are the proof.** `retries` greater than zero with the response served by the
HEALTHY deployment is the router selecting the dead peer, failing against it, and completing the
request on the surviving one. Requests 2 and 6 happened to be routed straight to the healthy peer, so
they needed no retry — which is what a round-robin over two deployments looks like.

**Request 1 failed and that is reported, not smoothed over:** HTTP 000 is the client timing out at 120s
on a cold model load, not a routing failure. A drill that hid it would be claiming a cleaner result
than the deployment delivers.

## Cleanup

`POST /model/delete` removed the drill peer; the pool is back to its original three, one deployment
each, verified by re-reading `/model/info`.

## What this does and does not close

**Closed:** failover on the production path works — a dead deployment does not fail a request.

**NOT closed, and it is the more important half:** the production config still has one deployment per
model, so today there is nothing to fail over TO. Failover is proven as a *capability* and absent as a
*configuration*. That is a deployment choice (a second inference host per model), so it belongs to the
fleet, not the console — logged as **G-210**.
