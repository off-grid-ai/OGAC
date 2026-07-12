# LLM Guard (content-guardrail engine) — deploy configs

The console's guardrail port (`src/lib/adapters/pii.ts`, sole engine, fail-closed) talks to an
LLM Guard API over `OFFGRID_HTTP_GUARDRAIL_URL` (POST `/analyze/prompt`, bearer `_API_KEY`).

## Configs
- **`scanners-full.yml`** — the FULL scanner suite (Anonymize/PII, PromptInjection, BanTopics,
  Toxicity, Gibberish, Language, BanCompetitors, Secrets, Regex, InvisibleText + output scanners).
  **`use_onnx: false` on every transformer scanner is REQUIRED** — the archived `laiyer/llm-guard-api`
  image references ONNX model files (e.g. `ProtectAI/deberta-v3-base-prompt-injection-v2 onnx/model.onnx`)
  that 404 at their pinned HF revisions; PyTorch weights load fine. Needs ~5–6 GB RAM in the container.
- **`scanners-pii.yml`** — a minimal PII-only fallback (Anonymize + regex/heuristic scanners, ~1.9 GB)
  for a memory-constrained host.

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
already run the data/control containers, so the full suite OOMs. Raising the OrbStack VM memory
(`orb config set memory_mib …` did NOT apply over SSH — use the OrbStack app's memory setting) to
~12 GB on the aux box unblocks it. The PII-only config runs today within the existing cap.
