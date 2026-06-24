# Architecture diagrams

Four diagrams that show the real Off Grid Console system — actual components, what each does, and
how they connect. Rendered with Gemini "Nano Banana Pro" (Gemini 3 Pro Image), the same image
pipeline the proposal generator uses.

| #   | Prompt                       | What it shows                                                                                                                                   |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `01-five-planes.txt`         | The five-plane agentic stack (Data / Control / AI / Regulatory / Consumption) with the console as the spine and the real component in each lane |
| 2   | `02-request-lifecycle.txt`   | One request through the single gateway: PII scan → policy → route → retrieve → generate → citation check, all logged + traced                   |
| 3   | `03-capability-ports.txt`    | Capability ports + swappable adapters (first-party default ⟷ OSS swap-in, one env var)                                                          |
| 4   | `04-deployment-topology.txt` | The bundled containers grouped by compose profile; only Console + Gateway + Postgres are required                                               |

## Generate

The renderer reads `GEMINI_API_KEY` from the env or a `.env` file (never hardcoded).

```bash
# one diagram
GEMINI_API_KEY=... python3 scripts/gen-diagram.py docs/diagrams/01-five-planes.txt

# all four
GEMINI_API_KEY=... bash scripts/gen-diagrams.sh
```

Each run writes a `.png` next to its prompt (e.g. `01-five-planes.png`). If a diagram misses the
intent, edit the prompt and re-run — the prompt is the source of truth; the PNG is a build artifact.

Model: `nano-banana-pro-preview` via `generateContent`, `responseModalities: [TEXT, IMAGE]`.
Aspect ratio is set in the prompt text (1024:572 ≈ 16:9), not a parameter.
