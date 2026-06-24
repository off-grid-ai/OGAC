#!/usr/bin/env bash
# Render all architecture diagrams with Nano Banana Pro. Needs GEMINI_API_KEY in env or .env.
set -eu
cd "$(dirname "$0")/.."
for prompt in docs/diagrams/*.txt; do
  echo "── rendering $prompt"
  python3 scripts/gen-diagram.py "$prompt"
done
echo "done — PNGs are next to their prompts in docs/diagrams/"
