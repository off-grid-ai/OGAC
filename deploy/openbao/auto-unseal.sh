#!/usr/bin/env bash
# OpenBao boot-time AUTO-UNSEAL for the on-prem S1 node.
#
# Why: OpenBao (OSS) has no cloud-KMS auto-seal available on this air-gapped/on-prem box, so
# "auto-unseal" is implemented as a boot service that feeds the Shamir unseal keys to a freshly
# started (sealed) vault — no human key entry after a reboot, while secrets still persist (file
# storage). The box holds the unseal material (root-owned, mode 600) — acceptable on owned hardware;
# the founder ALSO keeps the keys + root token offline as the recovery copy.
#
# ONE-TIME SUPERVISED SETUP (founder present to receive keys):
#   1) Bring up the persistent vault:  docker compose --profile secrets up -d openbao   (comes up SEALED)
#   2) bao operator init -key-shares=5 -key-threshold=3   → prints 5 unseal keys + 1 root token ONCE.
#      Founder stores ALL of them offline (password manager). NEVER commit them.
#   3) Write the threshold keys to the root-only key file this script reads:
#        sudo install -m 600 /dev/null /Users/admin/offgrid/secrets/openbao-unseal.keys
#        printf '%s\n%s\n%s\n' "<key1>" "<key2>" "<key3>" | sudo tee /Users/admin/offgrid/secrets/openbao-unseal.keys >/dev/null
#   4) Install the launchd job (deploy/openbao/co.getoffgridai.openbao-unseal.plist) so this runs on boot.
#   5) Enable the KV mount + set the console's scoped token (see SERVER_STATE.md § OpenBao).
#
# This script: waits for the vault socket, then submits each key until unsealed. Idempotent + safe to
# re-run (a no-op if already unsealed).
set -euo pipefail

BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
KEYS_FILE="${OPENBAO_UNSEAL_KEYS:-/Users/admin/offgrid/secrets/openbao-unseal.keys}"

[ -r "$KEYS_FILE" ] || { echo "unseal: keys file $KEYS_FILE not readable — aborting"; exit 1; }

# Wait for the server to answer (sealed is fine).
for i in $(seq 1 30); do
  if curl -fsS "$BAO_ADDR/v1/sys/health?sealedcode=200&uninitcode=200" >/dev/null 2>&1; then break; fi
  sleep 2
done

sealed() { curl -fsS "$BAO_ADDR/v1/sys/seal-status" | grep -q '"sealed":true'; }

if ! sealed; then echo "unseal: already unsealed — nothing to do"; exit 0; fi

while IFS= read -r key; do
  [ -n "$key" ] || continue
  curl -fsS -X PUT "$BAO_ADDR/v1/sys/unseal" -d "{\"key\":\"$key\"}" >/dev/null || true
  sealed || { echo "unseal: vault unsealed"; exit 0; }
done < "$KEYS_FILE"

if sealed; then echo "unseal: still sealed after all keys — check threshold/keys"; exit 1; fi
echo "unseal: done"
