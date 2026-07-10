#!/usr/bin/env bash
#
# Off Grid Console — secret-scan gate (#226).
#
# Runs `gitleaks detect` over the working tree using .gitleaks.toml. This is the
# LOCAL half of the secret gate; CI runs the gitleaks-action as the always-on
# backstop (.github/workflows/ci.yml). We scan the working tree (`--no-git`) so
# an as-yet-uncommitted secret is caught BEFORE it ever lands in history.
#
# If the gitleaks binary is not installed, we DO NOT fail the developer's push
# (installing a Go binary is not something every dev has done) — we print a clear
# message pointing at the install + the CI backstop, and exit 0. CI always runs
# the real scan, so nothing slips through: the local run is a fast-feedback
# convenience, the CI job is the gate.
#
# Install locally (macOS):  brew install gitleaks
#              (linux):     see https://github.com/gitleaks/gitleaks#installing
#
# Exit codes: 0 = clean (or binary absent), 1 = leaks found (blocks the push).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "security:secrets: gitleaks not installed locally — SKIPPING the local scan."
  echo "                  (CI runs the gitleaks-action as the always-on backstop.)"
  echo "                  Install it for local pre-push coverage:  brew install gitleaks"
  exit 0
fi

echo "security:secrets: gitleaks detect (working tree) …"
# --no-git: scan files on disk (incl. uncommitted), not just committed history.
# --redact: never print the secret value itself into logs/CI output.
# --config: our allowlist over gitleaks' default rules.
if gitleaks detect \
  --source . \
  --config .gitleaks.toml \
  --no-git \
  --redact \
  --verbose; then
  echo "security:secrets: OK — no secrets detected."
else
  echo "security:secrets: FAILED — gitleaks found a potential secret above (value redacted)."
  echo "                  If it is a false positive, add an allowlist entry to .gitleaks.toml."
  echo "                  If it is REAL, do NOT just delete the line — rotate the credential and"
  echo "                  scrub history (supervised). Flag it to the orchestrator."
  exit 1
fi
