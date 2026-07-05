#!/usr/bin/env bash
# Create the Cloudflare DNS CNAMEs that point subdomains at the tunnel. Idempotent-ish
# (Cloudflare rejects duplicates; safe to re-run — it'll report "already exists").
#
# Needs a Cloudflare API token + the getoffgridai.co zone id. They live in
# ../../../mobile/.env.keygen (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_GETOFFGRIDAI).
#
#   ./dns-records.sh
set -euo pipefail

ENV_FILE="${CF_ENV_FILE:-$(cd "$(dirname "$0")/../../.." && pwd)/mobile/.env.keygen}"
TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
ZONE=$(grep '^CLOUDFLARE_ZONE_GETOFFGRIDAI=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' \r')
TUNNEL_CNAME="00000000-0000-0000-0000-000000000000.cfargotunnel.com"

# Subdomains created this session. Add new tunnel-fronted hostnames here.
NAMES=(auth ssh provit console-api)

for name in "${NAMES[@]}"; do
  resp=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$TUNNEL_CNAME\",\"proxied\":true}")
  echo "$name.getoffgridai.co → $(echo "$resp" | grep -o '"success":[a-z]*' | head -1) $(echo "$resp" | grep -o '"message":"[^"]*"' | head -1)"
done
