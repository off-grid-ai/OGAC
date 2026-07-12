# LLM Guard (content-guardrail engine) — deploy configs

The console's guardrail port (`src/lib/adapters/pii.ts`, sole engine, fail-closed) talks to an
LLM Guard API over `OFFGRID_HTTP_GUARDRAIL_URL` (POST `/analyze/prompt`, bearer `_API_KEY`).

## Configs
- **`scanners-full.yml`** — the FULL scanner suite in ONE container (Anonymize/PII, PromptInjection,
  BanTopics, Toxicity, Gibberish, Language, BanCompetitors, Secrets, Regex, InvisibleText + output
  scanners). **`use_onnx: false` on every transformer scanner is REQUIRED** — the archived
  `laiyer/llm-guard-api` image references ONNX model files (e.g.
  `ProtectAI/deberta-v3-base-prompt-injection-v2 onnx/model.onnx`) that 404 at their pinned HF
  revisions; PyTorch weights load fine. Needs ~5–6 GB — OOMs a 7.8 GB VM, so we shard instead (below).
- **`scanners-pii.yml`** — the PII/DLP shard: Anonymize + Secrets + Regex + BanSubstrings +
  InvisibleText (~1.9 GB). Runs on S1.
- **`scanners-classifiers.yml`** — the heavy-classifier shard: PromptInjection + Toxicity + Gibberish
  + Language (~4.3 GB). Runs on S2. Together with the PII shard + the aggregator this is the full
  suite, split to fit the VM cap (see SHARDED topology below).

## Run (headless OrbStack, e.g. on S2 / the aux box)
    docker run -d --name llm-guard --restart unless-stopped -p 127.0.0.1:8000:8000 \
      -e AUTH_TOKEN=<token> -e LOG_LEVEL=INFO \
      -v $PWD/scanners-full.yml:/home/user/app/config/scanners.yml:ro \
      laiyer/llm-guard-api:0.3.16
    # then on the console host: OFFGRID_ADAPTER_GUARDRAILS=llm-guard,
    # OFFGRID_HTTP_GUARDRAIL_URL=http://127.0.0.1:8000 (loopback fwd to the guard host),
    # OFFGRID_HTTP_GUARDRAIL_API_KEY=<token>; restart the console.

## Capacity note (2026-07-12)
The FULL suite needs ~5–6 GB in the container. The fleet's OrbStack VMs are capped at 7.8 GB and
already run the data/control containers, so the full suite OOMs in ONE container. Raising the
OrbStack VM memory (`orb config set memory_mib …` did NOT apply over SSH — needs the OrbStack app's
memory GUI) was the original unblock, but the cleaner one is **sharding** (below).

## SHARDED topology (2026-07-12, LIVE) — the full suite without raising VM memory
Instead of one fat container, the scanner suite is **split across fleet nodes**, each shard fitting
its own 7.8 GB VM, with a fan-out **aggregator** in front so the console still talks to ONE endpoint.

    console  ──POST /analyze/prompt──▶  guardrail-aggregator (S1, 127.0.0.1:8010, root LaunchDaemon)
                                          ├─▶ pii shard         (S1  127.0.0.1:8000)  scanners-pii.yml         [required]
                                          └─▶ classifiers shard (S2  offgrid-s2.local:8000) scanners-classifiers.yml [optional]

- **`scripts/guardrail-aggregator.mjs`** (S1) fans the prompt to both shards and merges the verdicts
  (pure merge in `scripts/lib/guard-merge.mjs`, unit-tested). It runs as a **root** LaunchDaemon
  (`/Library/LaunchDaemons/co.getoffgridai.guard-aggregator.plist`) — root reaches the LAN
  (`offgrid-s2.local`); a user LaunchAgent is blocked by macOS Local Network privacy, exactly like
  the gateway aggregator. Caddy is the public edge; the internal fleet fan-out is the aggregator's job.
- **Fail-closed vs degrade:** the on-box PII shard is REQUIRED (down → the aggregator 502s → the
  console blocks the run). The S2 classifier shard is OPTIONAL — if S2 hiccups, the verdict stands on
  the PII shard and the response carries `x-offgrid-guard-degraded: classifiers`, so a flaky aux node
  never takes governed runs offline. `GET /health` on :8010 shows per-shard state.

### Bring up / restart a shard
    # classifiers shard on S2 (LAN-bound, token-protected like the gateways; --memory caps a crash):
    docker run -d --name llm-guard-classifiers --restart unless-stopped --memory 6g \
      -p 0.0.0.0:8000:8000 -e AUTH_TOKEN=<token> -e LOG_LEVEL=INFO \
      -v /tmp/scanners-classifiers.yml:/home/user/app/config/scanners.yml:ro laiyer/llm-guard-api:0.3.16
    # NB: `--restart unless-stopped` reuses the container on reboot so the downloaded HF models
    # persist; only a `docker rm` re-downloads (~4 min — no HF cache volume is mounted).

### Console wiring (on the box .env.local — NOT git)
    OFFGRID_ADAPTER_GUARDRAILS=llm-guard
    OFFGRID_HTTP_GUARDRAIL_URL=http://127.0.0.1:8010   # the aggregator, not a shard
    OFFGRID_HTTP_GUARDRAIL_API_KEY=<token>             # = the aggregator's OFFGRID_GUARD_AGGREGATOR_TOKEN

To add a THIRD shard (e.g. BanTopics/NoRefusal/BanCompetitors on another node), append it to the
daemon's `OFFGRID_GUARD_SHARDS` JSON with its own `OFFGRID_GUARD_TOKEN_<NAME>` and kickstart the
aggregator — no console change.
