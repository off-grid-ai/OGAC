# Adversarial QA — Settings / Configuration surfaces

Adversary run against wave2 HEAD (`7ea13b8`) in an isolated worktree. Goal: prove the developer
wrong across every settings/config surface. No writes against the live demo (probes read-only; all
mutation break-attempts are pure/local red tests). Red tests live in
`test/adversarial-settings-config.test.ts` (skipped so the shared suite stays green; flip `.skip`
to reproduce).

## Surfaces mapped

| Surface | Page / route | Owning lib | Persistence |
| --- | --- | --- | --- |
| Global Config (env-backed) | `/operations/config` · `api/v1/admin/config` (+`/reveal`) | `config.ts`, `config-registry.ts`, `display-host.ts` | `.env.local` on server, restart-required |
| Rate limit (per-key) | `KeyRateLimit`/`IssueKeyButton` · `api/v1/admin/keys/[id]` | `rate-limit.ts`, `rate-limit-store.ts` | DB (`api_keys`) |
| Backups schedule/config | `/operations/backups` · `api/v1/admin/backups` | `backups.ts`, `backups-view.ts` | env (read-once at module load) |
| Secrets / OpenBao | `SecretsManager`/`SealControl` · `api/v1/admin/secrets/**` | `secrets-ops.ts`, `secret-keys.ts` | OpenBao (write-only) |
| Federation / Keycloak IdP | `IdpList`/`RealmLifetimes` · `api/v1/admin/access/**` | `keycloak-admin.ts`, `keycloak-realm.ts` | Keycloak realm |
| Connectors config | `ConnectorRowActions`/`AddConnectorButton` · `api/v1/admin/connectors/**` | `connector-policy.ts`, `connector-secrets.ts` | DB + OpenBao |
| Org ROI / budget / observability | `RoiOrgDefaults`/`ThresholdManager` · `api/v1/admin/roi`, `.../observability/**` | `roi.ts`, `budget-config.ts`, `observability-settings.ts` | DB / flags / env |

## Axes exercised

entry type (string/url/secret/bool/enum) × secret-vs-plain × restart-required × host-value-vs-editable
× valid/invalid/empty/oversized/hostile × role (viewer read-only vs admin) × persistence (env-file/DB
vs local-only) × reveal/redaction.

## Confirmed breaks (severity-ranked)

### G-ADV-SET-1 — host config round-trip is LOSSY: a real LAN IP is silently rewritten to loopback (HIGH)
`config.ts:57` (display) + `config.ts:87` (save) + `display-host.ts:mapHostname/toConnectHost`.
`configDisplayValue` maps `192.168.1.59` → `offgrid-s1.local` for display; `configConnectValue` maps
`offgrid-s1.local` → `127.0.0.1` on save. So opening Config, editing ANY host field, and saving
persists `127.0.0.1` instead of the original `192.168.1.59`. On a deployment where the console is NOT
co-located with S1, loopback ≠ the real backend → connectivity BREAKS after the next restart. The
round-trip is only lossless for values that were already `127.0.0.1`.
Red: `test/adversarial-settings-config.test.ts` G-ADV-SET-1. Artifact: `got http://127.0.0.1:6333/`.

### G-ADV-SET-3 — editing a host field to an unknown private IP discards the input entirely (HIGH)
Same seam. `display-host.isPrivateIPv4` maps ANY RFC-1918 IP to `offgrid-s1.local`; `toConnectHost`
then maps that to `127.0.0.1`. So typing a brand-new backend at `http://10.0.0.5:6333` into a host
field and saving persists `http://127.0.0.1:6333/` — the operator's explicit address is thrown away.
The UI reports success; the value on disk is wrong.
Red: G-ADV-SET-3. Artifact: `got http://127.0.0.1:6333/`.

### G-ADV-SET-5 — reveal route leaks a raw loopback/IP for host-bearing keys (MEDIUM-HIGH)
`api/v1/admin/config/reveal/route.ts:17` calls `revealConfig(key)`, which (`config.ts:69-73`) returns
`fileMap[key] ?? process.env[key]` RAW — it never runs `configDisplayValue`. The GET config list DOES
mask host values to mDNS (`config.ts:57`). So for a host-bearing NON-secret key (e.g.
`OFFGRID_GATEWAY_URL`, `OFFGRID_QDRANT_URL`), the list shows `offgrid-s1.local` but reveal returns the
raw `http://127.0.0.1:4000` — directly violating the founder directive ("no `127.0.0.1`/raw IP may ever
be EXPOSED in the UI") AND a §A drift tell (two surfaces show two different values for the same key).
Endpoint is admin-gated (probe: unauth → 401), so it needs an admin session to trigger. Code-level
confirmed; not live-triggered to avoid an authenticated session against the demo. NOTE also
`reveal/route.ts:22` runs `redactSecretForViewer` on the value WITHOUT checking `def.secret`, so a
viewer revealing a non-secret key gets it masked to `••••••••` (over-redaction) — wrong, though
harmless. File:line: `reveal/route.ts:17,22`; `config.ts:69`.

### G-ADV-SET-4 — connector PATCH accepts input the CREATE rule rejects (validation asymmetry + DRY) (MEDIUM)
`api/v1/admin/connectors/route.ts` (POST) validates the body through `validateConnectorCreate`
(`connector-policy.ts:185`) — unknown/unready type → 400, malformed SQL endpoint → 400. But
`api/v1/admin/connectors/[id]/route.ts:16` (PATCH) validates ONLY the `auth` enum and passes
`body.type` + `body.endpoint` straight to `updateConnector`. So editing a connector to
`type='totally-bogus'` or an unparseable endpoint PERSISTS with 200 → a silently-broken connector
(status goes to error later, no inline validation). Same decision exists in the pure lib but the
update path does not reuse it (DRY/SoC break — the rule is not one source of truth across create+update).
Red: G-ADV-SET-4 (proves CREATE rejects what PATCH accepts). Route-level repro: `PATCH {type:'totally-bogus'}` → 200.

### G-ADV-SET-2 — config host round-trip is not idempotent (normalization drift) (LOW)
`display(connect('http://offgrid-s1.local:4000'))` → `http://offgrid-s1.local:4000/` (trailing slash).
So a diff/"is this dirty?" check is unreliable — a field can report a pending change when nothing was
meaningfully edited, and audit old/new values differ only by normalization.
Red: G-ADV-SET-2. Artifact: `got http://offgrid-s1.local:4000/`.

## SOLID / DRY / SoC violations (flagged, not all separately red)

- **DRY — rate-limit normalization defined 3×**: `KeyRateLimit.tsx:50` (client), `keys/[id]/route.ts` (route
  validation), `rate-limit-store.ts:normalizeLimit`. Three slightly-different clamps of the same rule;
  drift risk. One pure helper should own "coerce a raw rate-limit → number|null".
- **DRY — connector create-validation not reused on update** (G-ADV-SET-4 above). The PATCH route should
  call the same `validateConnectorCreate`/`connectorTypeDef` seam as POST.
- **DRY — realm-lifetimes validation in both component and server**: `RealmLifetimes.tsx` re-implements the
  non-negative-integer check that `keycloak-realm.ts:validateLifetimesPatch` already owns.
- **DRY — `KcAdminOp` type + `OP_ROLE` map** (`keycloak-realm.ts:16-27`) restate the same op set twice; a new
  op must be added in both or the forbidden-grant message breaks.
- **SoC — reveal route redacts without consulting the registry's `secret` flag** (`reveal/route.ts:22`): the
  redaction decision should be driven by the key's declared `secret`, not applied blanket.
- **§A tell — presentation holding authoritative-but-stale config**: `RoiOrgDefaults.tsx` shows
  `Current: {initial.minutesSavedPerRun}` seeded once from props and never re-seeded after save;
  `AppRoiCard.tsx` has no `useEffect` to re-sync when `initial` changes. Both show a stale "current" after a
  successful save until a full reload. (State-consistency, not data-loss — save DOES persist.)

## False positives ruled out (checked, developer was RIGHT)

- ROI PUT route DOES validate server-side via `validateRoiSettingsInput` (bounds-checked
  `validateEstimateField`) — the "no server bounds check" claim is wrong. `roi/route.ts:32`.
- Budget env-over-flag precedence is intentional + documented (`budget-config.ts:1-15`); "no logging" is a
  UX nit, not a break.
- Connector create-form password field IS `type="password"` (masked). Secrets are write-only, hashed
  (`token_hash`), never echoed in lists. No secret-leak in the connector/secrets list surfaces.
- Observability threshold UPDATE route DOES re-validate via `validateThresholdRule`.

## Coverage ledger

| Surface / axis | Status |
| --- | --- |
| Config host round-trip persist (edit→save→reload) | ❌ break (G-ADV-SET-1, -2, -3) |
| Config reveal redaction / host masking | ❌ break (G-ADV-SET-5) |
| Config secret redaction in list (GET masks secrets) | ✓ correct |
| Config viewer write → 403 (middleware + requireAdmin) | ✓ correct |
| Connector create validation | ✓ correct |
| Connector update validation | ❌ break (G-ADV-SET-4) |
| ROI settings validation | ✓ correct |
| Secrets write-only / no echo | ✓ correct |
| Rate-limit normalization DRY | ⚠️ duplicated (3 places) |
| Realm-lifetimes / IdP secret-on-error UX | ⚠️ state-clearing gaps (not data loss) |
| Backups config editability (CRUD bar) | ⚠️ read-only tiles, no edit form |
