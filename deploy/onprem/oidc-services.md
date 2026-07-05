# Native-OIDC config for the UI services — READY TO FLIP (Phase D)

**What this is.** The literal "one identity everywhere" for the three services that have their own UI
and can validate Keycloak tokens **themselves** (not just console-brokered): **OpenSearch**,
**FleetDM**, **Superset**. This is **config on the stock images + Keycloak clients** — no image
patching.

**What this is NOT.** None of this is enabled on the live fleet. Enabling native OIDC on any of these
is an on-site operational change (it changes how the service authenticates and, for OpenSearch, turns
the security plugin ON — which today is `DISABLE_SECURITY_PLUGIN=true` so the console's no-auth reads
work). Everything below is a **one-flag enable**: the Keycloak clients + roles are already seeded
(`deploy/keycloak/offgrid-realm.json`), the config blocks are here verbatim, and the enable steps are
recorded in `SERVER_STATE.md`. Flip it during a maintenance window, on site.

**Realm facts referenced below (from the seed + SERVER_STATE.md):**

| Fact | Value |
|---|---|
| Realm | `offgrid` |
| Public issuer | `https://auth.getoffgridai.co/realms/offgrid` |
| LAN issuer | `http://127.0.0.1:8080/realms/offgrid` (or `http://offgrid-s1.local:8080/…`) |
| JWKS (certs) | `<issuer>/protocol/openid-connect/certs` |
| Authorization endpoint | `<issuer>/protocol/openid-connect/auth` |
| Token endpoint | `<issuer>/protocol/openid-connect/token` |
| Userinfo | `<issuer>/protocol/openid-connect/userinfo` |
| OIDC discovery | `<issuer>/.well-known/openid-configuration` |

> Use the **public** issuer for browser-facing login (OpenSearch Dashboards, FleetDM, Superset UIs) so
> the redirect resolves for the operator's browser. Use the **LAN** issuer for pure server-to-server
> JWKS validation (OpenSearch JWT auth domain) so the container fetches keys without leaving the LAN.
> Both are accepted by the console's verifier (`OFFGRID_KEYCLOAK_ISSUERS`); Keycloak signs with the
> same realm key regardless of which host requested the token, so a token minted at one issuer
> validates against JWKS fetched from the other **only if the `iss` host is in the service's accepted
> set** — for OpenSearch JWT, set `jwt_url`/`openid_connect_url` to match the issuer the tokens carry.

---

## 1. OpenSearch — security plugin: OIDC (Dashboards login) + JWT (API)

**Client:** `offgrid-opensearch` (seeded, confidential, audience `offgrid-opensearch`).
**State today:** `DISABLE_SECURITY_PLUGIN=true` in `services-node-a.yml` → **no auth**, the console
reads OpenSearch anonymously over loopback. Enabling security is the bigger change; keep it OPTIONAL.

Two auth domains on the same cluster:

- **`openid`** — Dashboards SSO: an operator logs into OpenSearch Dashboards via Keycloak.
- **`jwt`** — API bearer: a Keycloak JWT (from the console broker or any client) is accepted directly
  on the REST API, validated against the realm JWKS. This is what lets the console (or a user token)
  hit `:9200` with `Authorization: Bearer <kc-jwt>` instead of anonymous loopback.

### 1a. `config.yml` (security plugin — authc block)

Mounted at `/usr/share/opensearch/config/opensearch-security/config.yml`:

```yaml
_meta:
  type: 'config'
  config_version: 2
config:
  dynamic:
    authc:
      # ── OIDC: browser SSO into OpenSearch Dashboards ──
      openid_auth_domain:
        http_enabled: true
        transport_enabled: true
        order: 0
        http_authenticator:
          type: openid
          challenge: false
          config:
            subject_key: preferred_username
            roles_key: realm_access.roles         # KC realm roles → OpenSearch roles (map below)
            openid_connect_url: https://auth.getoffgridai.co/realms/offgrid/.well-known/openid-configuration
        authentication_backend:
          type: noop
      # ── JWT: accept a Keycloak Bearer directly on the REST API ──
      jwt_auth_domain:
        http_enabled: true
        transport_enabled: true
        order: 1
        http_authenticator:
          type: jwt
          challenge: false
          config:
            # Validate signature against the realm JWKS (no shared secret — RS256 via JWKS).
            jwt_url: https://auth.getoffgridai.co/realms/offgrid/protocol/openid-connect/certs
            jwt_header: Authorization
            subject_key: preferred_username
            roles_key: realm_access.roles
            required_audience: offgrid-opensearch     # matches the seeded audience mapper
            jwt_clock_skew_tolerance_seconds: 30
        authentication_backend:
          type: noop
      # Keep basic/internal as a break-glass fallback so you're never locked out.
      basic_internal_auth_domain:
        http_enabled: true
        transport_enabled: true
        order: 2
        http_authenticator:
          type: basic
          challenge: true
        authentication_backend:
          type: internal
```

### 1b. Dashboards `opensearch_dashboards.yml` (OIDC frontend)

```yaml
opensearch_security.auth.type: 'openid'
opensearch_security.openid.connect_url: https://auth.getoffgridai.co/realms/offgrid/.well-known/openid-configuration
opensearch_security.openid.client_id: offgrid-opensearch
opensearch_security.openid.client_secret: '${OPENSEARCH_OIDC_CLIENT_SECRET}'   # from OpenBao secret/opensearch/client-secret
opensearch_security.openid.base_redirect_url: https://opensearch.getoffgridai.co
opensearch_security.openid.scope: 'openid profile email'
opensearch_security.cookie.secure: true
```

### 1c. `roles_mapping.yml` (KC roles → OpenSearch roles)

```yaml
all_access:
  reserved: false
  backend_roles:
    - 'svc-opensearch'   # the console broker's service token role → full access
    - 'console-admin'    # operators with the console-admin realm role
kibana_user:
  reserved: false
  backend_roles:
    - 'svc-opensearch'
```

### 1d. Enable steps (on site, `services-node-a.yml`) — DO NOT flip unattended

1. Store the client secret in OpenBao: `secret/opensearch/client-secret` (the value from the seed,
   `offgrid-dev-svc-opensearch-secret`, or a rotated one via the console client-provisioning route).
2. In `services-node-a.yml`, on the `opensearch` service: **remove** `DISABLE_SECURITY_PLUGIN: 'true'`
   and mount the three security-config files (`config.yml`, `roles_mapping.yml`, plus the stock
   `roles.yml`/`internal_users.yml`) into `/usr/share/opensearch/config/opensearch-security/`.
3. On `opensearch-dashboards`: **remove** `DISABLE_SECURITY_DASHBOARDS_PLUGIN: 'true'`, mount
   `opensearch_dashboards.yml`, and set `OPENSEARCH_HOSTS` to `https://opensearch:9200` (TLS on).
4. Run `securityadmin.sh` once to push the new security config into the cluster index.
5. **Console impact:** once security is on, the console's OpenSearch reads must send a Bearer. The
   broker already knows how (`credentialPlan('opensearch')` → flip from `'none'` to `'oidc-jwt'` in
   `src/lib/service-credentials-lib.ts`, one line — its TODO already names this). Do that in the SAME
   change that enables the plugin, or the console's analytics/audit reads will 401.

> Until steps 1–5 run, OpenSearch stays no-auth and the console keeps reading it anonymously —
> unchanged. The plan map deliberately keeps `opensearch: 'none'` so the broker never sends a JWT to a
> cluster that isn't validating one yet.

---

## 2. FleetDM — OIDC SSO (env on the stock image)

**Client:** `offgrid-fleet` (seeded, confidential, audience `offgrid-fleet`).
**State today:** FleetDM UI uses its own local users; the console calls its REST API with a static/
OpenBao token (`credentialPlan('fleet')` = `'native-bearer'` — **that stays**, this is only about the
human UI login). FleetDM supports SSO via SAML natively and OIDC via its MDM/SSO settings.

FleetDM's OIDC SSO is configured through its app config (YAML applied with `fleetctl apply`) or the
equivalent env. Ready-to-apply SSO settings block:

```yaml
# fleet-sso.yml  →  fleetctl apply -f fleet-sso.yml
apiVersion: v1
kind: config
spec:
  sso_settings:
    enable_sso: true
    enable_jit_provisioning: true          # auto-create the Fleet user on first Keycloak login
    idp_name: "Off Grid Keycloak"
    # FleetDM's OIDC/OpenID connector:
    entity_id: offgrid-fleet
    issuer_uri: https://auth.getoffgridai.co/realms/offgrid
    metadata_url: https://auth.getoffgridai.co/realms/offgrid/.well-known/openid-configuration
```

If pinning to env on the container instead of `fleetctl apply` (stock image reads these):

```
FLEET_SSO_ENABLE_SSO=true
FLEET_SSO_ENABLE_JIT_PROVISIONING=true
FLEET_SSO_IDP_NAME=Off Grid Keycloak
FLEET_SSO_ENTITY_ID=offgrid-fleet
FLEET_SSO_ISSUER_URI=https://auth.getoffgridai.co/realms/offgrid
FLEET_SSO_METADATA_URL=https://auth.getoffgridai.co/realms/offgrid/.well-known/openid-configuration
```

**Keycloak client redirect URI for FleetDM SSO callback:** add
`https://fleet.getoffgridai.co/api/v1/fleet/sso/callback` to `offgrid-fleet`'s `redirectUris` when SSO
goes live (the seed keeps `offgrid-fleet` as a client_credentials service client for the console
broker; adding SSO means enabling `standardFlowEnabled` + that redirect on site).

### Enable steps (on site)
1. Ensure `offgrid-fleet` client has `standardFlowEnabled: true` + the SSO callback redirect URI.
2. Set the `FLEET_SSO_*` env on the `fleet` service in `services-node-b.yml` (or apply `fleet-sso.yml`).
3. Restart FleetDM; verify the "Sign in with Off Grid Keycloak" button on the login page.
4. **No console impact** — the console keeps using its native Fleet API token (`native-bearer`).

---

## 3. Superset — AUTH_OAUTH (Flask-AppBuilder) via `superset_config.py`

**Client:** `offgrid-superset` (seeded — a login client: `standardFlowEnabled`, redirect
`…/oauth-authorized/keycloak`, audience `offgrid-superset`, secret `offgrid-dev-svc-superset-secret`).
**State today:** Superset uses its stock admin login (`superset init`). This adds Keycloak OAuth login
without touching the console's brokered guest-token embed path.

`superset_config.py` (mount at `/app/pythonpath/superset_config.py`):

```python
from flask_appbuilder.security.manager import AUTH_OAUTH

AUTH_TYPE = AUTH_OAUTH

# Auto-create a Superset user on first Keycloak login, default role Gamma (read-only-ish).
AUTH_USER_REGISTRATION = True
AUTH_USER_REGISTRATION_ROLE = "Gamma"

OIDC_ISSUER = "https://auth.getoffgridai.co/realms/offgrid"

OAUTH_PROVIDERS = [
    {
        "name": "keycloak",
        "icon": "fa-key",
        "token_key": "access_token",
        "remote_app": {
            "client_id": "offgrid-superset",
            "client_secret": "offgrid-dev-svc-superset-secret",  # or os.environ["SUPERSET_OIDC_CLIENT_SECRET"]
            "server_metadata_url": f"{OIDC_ISSUER}/.well-known/openid-configuration",
            "api_base_url": f"{OIDC_ISSUER}/protocol/",
            "client_kwargs": {"scope": "openid email profile"},
            "access_token_url": f"{OIDC_ISSUER}/protocol/openid-connect/token",
            "authorize_url": f"{OIDC_ISSUER}/protocol/openid-connect/auth",
            "jwks_uri": f"{OIDC_ISSUER}/protocol/openid-connect/certs",
        },
    }
]

# Map Keycloak realm roles → Superset roles (optional; refine per policy).
AUTH_ROLES_MAPPING = {
    "console-admin": ["Admin"],
    "svc-superset": ["Gamma"],
}
AUTH_ROLES_SYNC_AT_LOGIN = True


# Flask-AppBuilder calls this to read the userinfo for the "keycloak" provider.
def oauth_user_info(sm, provider, response=None):
    if provider == "keycloak":
        me = sm.oauth_remotes[provider].get(
            "openid-connect/userinfo"
        ).json()
        return {
            "username": me.get("preferred_username"),
            "email": me.get("email"),
            "first_name": me.get("given_name"),
            "last_name": me.get("family_name"),
            "role_keys": me.get("realm_access", {}).get("roles", []),
        }
```

Wire the userinfo hook by assigning it on the security manager (Superset reads a custom SM, or set
`CUSTOM_SECURITY_MANAGER`); the simplest supported form is to place `oauth_user_info` on a subclassed
`SupersetSecurityManager` and point `CUSTOM_SECURITY_MANAGER` at it. Keep it minimal on first enable.

### Enable steps (on site)
1. Store the secret in OpenBao `secret/superset/client-secret` (or env `SUPERSET_OIDC_CLIENT_SECRET`),
   and reference it in `superset_config.py` rather than hardcoding for prod.
2. Mount `superset_config.py` into the `superset` service in `services-node-b.yml` and set
   `SUPERSET_CONFIG_PATH=/app/pythonpath/superset_config.py`.
3. `docker compose … exec superset superset init` (already the documented one-time step), restart.
4. Verify the "Sign in with keycloak" button; confirm role mapping (`console-admin` → Admin).
5. **No console impact** — the brokered guest-token embed continues to work independently.

---

## Summary: ready vs on-site enable

| Service | Config delivered here | KC client (seeded) | Ready | Needs on-site enable |
|---|---|:--:|:--:|---|
| OpenSearch | `config.yml` (openid+jwt), Dashboards yml, roles_mapping | `offgrid-opensearch` | ✅ | remove `DISABLE_SECURITY_PLUGIN`, mount security config, `securityadmin.sh`, flip broker plan `opensearch: 'none'→'oidc-jwt'` |
| FleetDM | `sso_settings` YAML + `FLEET_SSO_*` env | `offgrid-fleet` | ✅ | add `standardFlow`+callback redirect, set env, restart |
| Superset | `superset_config.py` (AUTH_OAUTH) | `offgrid-superset` (NEW) | ✅ | mount config, `superset init`, restart |

**Nothing above is live.** The realm seed, `SERVICE_CLIENTS` code SSOT, and this config file are the
"ready" half; each service's "Enable steps" is the on-site half. See `SERVER_STATE.md` §
"Native-OIDC for UI services (Phase D — READY, not enabled)".
