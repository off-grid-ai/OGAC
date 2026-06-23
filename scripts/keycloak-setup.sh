#!/usr/bin/env bash
# Idempotently provision a Keycloak realm + OIDC client + test user for the console, then print the
# AUTH_KEYCLOAK_* env block to paste into .env.local. Bring Keycloak up first: `make identity`.
# This turns the manual admin-console click-through into one command so identity is reproducible.
set -u
KC="${OFFGRID_KEYCLOAK_URL:-http://localhost:8080}"
REALM="${KC_REALM:-offgrid}"
CLIENT="${KC_CLIENT:-offgrid-console}"
ADMIN_USER="${KC_ADMIN_USER:-admin}"
ADMIN_PW="${KC_ADMIN_PW:-offgrid-dev}"
REDIRECT="${KC_REDIRECT:-http://localhost:3000/api/auth/callback/keycloak}"
TEST_USER="${KC_TEST_USER:-advisor}"
TEST_PW="${KC_TEST_PW:-advisor-pw}"

tok() {
  curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" -d "password=$ADMIN_PW" |
    sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

TOK="$(tok)"
[ -n "$TOK" ] || { echo "✗ could not get admin token — is Keycloak up on $KC?"; exit 1; }
auth=(-H "Authorization: Bearer $TOK" -H 'content-type: application/json')

# realm (201 created, 409 already exists — both fine)
curl -s -o /dev/null -w 'realm: %{http_code}\n' -X POST "$KC/admin/realms" "${auth[@]}" \
  -d "{\"realm\":\"$REALM\",\"enabled\":true}"

# client
curl -s -o /dev/null -w 'client: %{http_code}\n' -X POST "$KC/admin/realms/$REALM/clients" "${auth[@]}" \
  -d "{\"clientId\":\"$CLIENT\",\"enabled\":true,\"protocol\":\"openid-connect\",\"publicClient\":false,\"standardFlowEnabled\":true,\"directAccessGrantsEnabled\":true,\"redirectUris\":[\"$REDIRECT\"],\"webOrigins\":[\"http://localhost:3000\"]}"

CID=$(curl -s "$KC/admin/realms/$REALM/clients?clientId=$CLIENT" "${auth[@]}" |
  sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
SECRET=$(curl -s "$KC/admin/realms/$REALM/clients/$CID/client-secret" "${auth[@]}" |
  sed -n 's/.*"value":"\([^"]*\)".*/\1/p')

# test user
curl -s -o /dev/null -w 'user:   %{http_code}\n' -X POST "$KC/admin/realms/$REALM/users" "${auth[@]}" \
  -d "{\"username\":\"$TEST_USER\",\"enabled\":true,\"email\":\"$TEST_USER@offgrid.local\",\"emailVerified\":true,\"firstName\":\"Field\",\"lastName\":\"Advisor\",\"credentials\":[{\"type\":\"password\",\"value\":\"$TEST_PW\",\"temporary\":false}]}"

cat <<EOF

── paste into .env.local ───────────────────────────────────────────────
AUTH_KEYCLOAK_ID=$CLIENT
AUTH_KEYCLOAK_SECRET=$SECRET
AUTH_KEYCLOAK_ISSUER=$KC/realms/$REALM
─────────────────────────────────────────────────────────────────────────
Test login: $TEST_USER / $TEST_PW  (admin console: $KC  →  $ADMIN_USER / $ADMIN_PW)
EOF
