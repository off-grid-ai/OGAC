# Adversarial QA — Secrets / Config store (OpenBao vault)

Adversary run against wave2 HEAD (`7ea13b8`). Scope: `src/app/api/v1/admin/secrets/**`,
`.../access/**/secret`, `.../config/reveal`, the OpenBao adapter (`src/lib/adapters/secrets.ts`),
`redactSecretForViewer` + the reveal path, service-client secret provisioning.

Goal: **prove a secret VALUE reaches someone who must not see it, or that secret access
crosses a tenant boundary.** Zero findings = not pushed hard enough.

## Axes explored

| axis | values |
|---|---|
| op | read / write / version / reveal / seal / lease / dynamic-db creds |
| classification | secret vs non-secret config key |
| vault state | up / down / sealed / uninitialized |
| role | viewer (public demo) / admin / machine service-account |
| org scoping | org A reading/writing org B's secret by key |

## Enumeration of every secret-bearing response (redaction audit)

| endpoint | method | returns a VALUE? | viewer-reachable? | verdict |
|---|---|---|---|---|
| `/admin/secrets` | GET | key NAMES + status only | yes (GET) | safe |
| `/admin/secrets` | POST/DELETE | no (echoes key only) | no (viewer 403 on write) | safe |
| `/admin/secrets/versions` | GET | version METADATA only (metadata path) | yes | safe |
| `/admin/secrets/leases` | GET | lease ids + TTL only | yes | safe |
| `/admin/secrets/dynamic-db` | GET | role NAMES only | yes | safe |
| `/admin/secrets/dynamic-db` | POST | **minted username/password** | **no** (POST → viewer 403) | safe by method-gate only |
| `/admin/secrets/seal` | POST | seal status only | no (POST) | safe |
| `/admin/access/clients/[id]/secret` | GET | `{configured:boolean}` only | yes | safe (fixed prior finding) |
| `/admin/access/clients/[id]/secret` | POST | cleartext secret ONCE | no (POST) | safe by method-gate |
| `/admin/access/service-clients/provision` | POST | no (path only) | no (POST) | safe |
| `/admin/config/reveal` | GET | **raw config value** (secret & non-secret) | **yes** | **BROKEN — see G-ADV-SEC-1/2** |
| `/admin/connectors`, `/exporters`, `/triggers/webhooks`, `/pipelines/[id]/keys` | GET | secretRef PATHS only, endpoints sanitized | yes | safe |

## Ledger of findings

### G-ADV-SEC-1 — reveal path leaks RAW host/IP to everyone (DRY/SoC break; extends G-ADV-SET-5)
`config/reveal/route.ts` → `revealConfig(key)` (`src/lib/config.ts:69`) returns the raw env value
**without** running `configDisplayValue`. The list path (`getConfigEntries`, `config.ts:57`) DOES
apply `configDisplayValue` to host-bearing keys so a raw `127.0.0.1`/LAN IP never reaches the client
(founder directive). The reveal path bypasses that entirely. An admin (and, for non-secret keys, a
viewer — see G-ADV-SEC-2) revealing `OFFGRID_GATEWAY_URL` / `OFFGRID_KEYCLOAK_URL` / any `hostValue`
key gets the raw loopback/LAN address. The "never leak raw host" rule lives in ONE place
(`configDisplayValue`) and the reveal route forgot to call it — a DRY/single-seam violation, same
class as the connector-bypass finding.
- **Root cause:** redaction/display logic applied per-route ad hoc; reveal reads raw env and only
  runs the *viewer*-redaction (`redactSecretForViewer`), never the *host*-display mapping.
- **Repro:** `revealConfig('OFFGRID_GATEWAY_URL')` with env `http://127.0.0.1:4000` → returns
  `http://127.0.0.1:4000` (should be the mDNS `offgrid-s1.local` display form).

### G-ADV-SEC-2 — redaction seam ignores the `secret` classification (viewer over/under-redaction risk)
`redactSecretForViewer(value, viewer)` (`viewer-policy.ts:62`) decides SOLELY on whether the value is
non-empty — it never consults the registry `def.secret` flag. The reveal route computes
`isViewer(role)` and redacts by role, but **nothing on the reveal path checks whether the key being
revealed is actually classified as a secret.** Consequences:
1. A viewer revealing a **non-secret** key (`OFFGRID_ADMIN_EMAILS`, `OFFGRID_KEYCLOAK_REALM`,
   `AUTH_DEV_LOGIN`) gets `••••••••` — non-sensitive operational config is hidden from the demo
   viewer (wrong, and inconsistent with the list view which shows non-secret values in full).
2. The safety of "viewer never sees a secret" rests entirely on the *value-non-empty* heuristic, not
   on the authoritative `secret` classification the registry already carries. If any future reveal
   caller forgets the `viewer` flag, or a secret is empty-string, the classification that SHOULD gate
   it is simply not in the decision. The correct seam is `redactSecret(def, value, viewer)` keyed on
   `def.secret`, in one place — not a value-shape guess.
- **Root cause:** redaction decision is not derived from the secret classification; the pure helper
  can't see `def.secret` and the route never passes it.
- **Repro:** `redactSecretForViewer('admin@corp.com', true)` → `••••••••` even though
  `OFFGRID_ADMIN_EMAILS` is `secret:false`.

### G-ADV-SEC-3 — secrets store is NOT tenant-isolated (cross-org read/write/rotate/destroy by key)
The secrets routes (`/admin/secrets`, `/versions`, `/leases`, `/dynamic-db`, `/seal`) call
`currentOrgId()` ONLY to stamp the audit-log actor — **never to scope the key**. OpenBao is a single
flat mount (`secret/<key>`, `adapters/secrets.ts:47`); keys are not namespaced by org. So an admin of
org A can GET/POST/DELETE/rotate/destroy org B's secret purely by knowing/guessing the key name
(`baoSet(key)`, `baoRemove(key)`, `baoRotate(key)`, `baoDestroyVersions(key)` all take a bare key).
The whole wave2 theme is tenant isolation; the secrets store has none. Every other CRUD surface
(connectors, exporters, pipelines) is `orgId`-scoped in its store query — secrets are the outlier.
- **Root cause:** no org prefix on the KV key path; `currentOrgId` used for audit only, not scoping.
- **Repro (LOCAL, fake adapter):** org-A session writes `secret/shared-key`; org-B session reads the
  same key via the same route and gets it back — no 404, no boundary. Asserted against a fake
  `SecretsPort` since we must not touch the live vault.

### Confirmed-safe (attacked, held)
- `access/clients/[id]/secret` GET returns `{configured}` only — **G-SEC-VIEWER-1 fix confirmed**;
  no repeatable un-scoped exfil.
- Versions/leases/dynamic-db GETs return metadata only (versions uses the KV `metadata` path, never
  `data`). Verified in `secrets-ops.ts`.
- Dynamic-DB creds + client-secret rotation + webhook/pipeline plaintext are all POST → blocked for
  the viewer by the method gate (`decideAdminGate` → `forbid-viewer-write`).
- Connector/exporter stores persist `secretRef` PATHS + credential-free endpoints; the create/update
  path peels embedded `user:pass@host` before persisting (`splitEndpointSecret`).

### Observation (not filed as a break)
`baoGet(key)` silently **falls back to `process.env[key]`** whenever OpenBao is unreachable or returns
non-200 (`adapters/secrets.ts:51,54`). For connector secret resolution the ref is a path
(`connectors/<id>/password`) that won't normally collide with an env var, so no direct leak — but a
DOWN vault silently degrades to env-backed reads instead of failing closed, which can mask an outage
and, if a secretRef ever equals an env-var name, cross wires. Fail-closed would be safer.
