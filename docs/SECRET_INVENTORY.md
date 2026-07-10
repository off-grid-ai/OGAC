# Secret Inventory

The map for the supervised pre-public pass (history scrub and key rotation). It lists every place in the working tree that still holds a real internal identifier or credential, grouped by what has to happen to it.

**Scope:** this scan covers the working tree only. Git history is a separate concern and is handled by the supervised history-rewrite step. Assume every value that ever appeared in the tree also lives in history until the scrub is done and verified from a fresh clone.

**Method:** `grep` across `*.md`, `*.ts`, `*.tsx`, `*.mjs`, `*.js`, `*.json`, `*.sh`, `*.yml`, `*.yaml`, `*.sql`, `*.env*`, excluding `node_modules/` and `.next/`, for: LAN IPs (`192.168.*`), internal hostnames (`*.local`), internal service subdomains (`*.getoffgridai.co`), gateway keys (`oglb_`), other key/token shapes (`sk-`, `AKIA`, `Bearer` literals), and credential literals (`OffGrid-2026`, `offgrid-dev*`, `*_SECRET`, `*_TOKEN`).

## Counts by category

| Category | Occurrences (working tree) |
|---|---|
| LAN IPs `192.168.*` (excl. vendored asset) | ~254 across 54 files |
| ...of which in `deploy/onprem/` (fleet-owned, another agent) | ~112 |
| Internal hostnames `*.local` | ~237 matches (S1/g6/gN/s2) |
| Internal subdomains `*.getoffgridai.co` | ~240 |
| Gateway keys `oglb_` | 3 (all placeholders, see below) |
| `sk-` / `AKIA` / real `Bearer` literals | 0 real (1 test literal, harmless) |
| `OffGrid-2026` (real console/Keycloak password) | 17 |

## MUST ROTATE (assume compromised once public)

Real credentials that grant access. Rotate before the repo is public, then confirm the old value no longer works.

- **`OffGrid-2026`**: real console / Keycloak user password. Rotate the account passwords.
  - `docs/SESSION_HANDOFF.md:168`
  - `scripts/shoot-docs.mjs:5,15`
  - `scripts/shoot-pipelines-docs.mjs:17`
  - `scripts/shoot-pipelines.mjs:10`
  - `scripts/shoot-walkthrough.mjs:2,10`
  - `scripts/shoot-landing.mjs:5,15`
  - `scripts/metrics-dashboard.mjs:102`
  - `w1verify.mjs:6`
- **`admin/offgrid-dev`**: Keycloak admin console credential, shown live in the metrics dashboard.
  - `scripts/metrics-dashboard.mjs:101`
  - `scripts/keycloak-setup.sh:10` (`KC_ADMIN_PW` default `offgrid-dev`)

Note on the `offgrid-dev*` DEV defaults below (`offgrid-dev-token`, `offgrid-dev-signing-key`, `offgrid-dev-keycloak-secret`): these are documented fall-open DEV placeholders, already flagged in `docs/PRODUCTION_READINESS.md` as values production must override. They are not production secrets, so they are not strictly rotate-me. But if the on-prem deployment ever ran with a default unset, the effective value equals the placeholder and must be rotated. The supervised pass should confirm production sets real values and, if not, rotate.
  - `src/lib/sign.ts:6`, `src/lib/trust-center-inputs.ts:21`: signing key default
  - `src/lib/adapters/secrets.ts:39`, `src/lib/secrets-view.ts:158`: OpenBao token default
  - `scripts/verify-adapters.sh:18`: OpenBao token default
  - `docs/OPERATIONS.md:238,282,372`, `docs/INTEGRATIONS.md:199,227,238`, `docs/PRODUCTION_READINESS.md:36,61`, `docs/research/SERVICE_AUDIT.md:110`, `docs/GAPS_BACKLOG.md:85`: documented dev tokens/secret

## MUST SCRUB FROM HISTORY (and clean from tree in the supervised pass)

Real internal topology. Genericizing these in the tree is not enough on its own, because they are also in history. The supervised pass rewrites history and, where safe, replaces the live values. Several of these are load-bearing runtime config (see the note under runtime code) and cannot simply be blanked without a config/env indirection, so they are deferred to the supervised pass rather than edited blindly here.

### Runtime code with real LAN IPs / hostnames (load-bearing, deferred)

These are real IPs baked into runtime behavior. Blanking them breaks the app. The supervised pass should move them behind env/config and then rotate the topology out of the tree and history.

- `src/lib/display-host.ts:15,16,30-40`: full fleet IP-to-hostname map (S1, g6, g1-g8, s2). This is the DISPLAY-scrubbing map, so the real IPs are its input data.
- `src/lib/data-domains-demo-seed.ts:64,67`: `DS_HOST = '127.0.0.1'`, used to build seeded connector endpoints.
- `src/lib/etl-model.ts:6`: comment referencing `192.168.1.60:8005`.
- `src/lib/services-directory.ts:82` (`provit.getoffgridai.co` default), `:270` (`192.168.1.60` comment), plus `offgrid-gN.local` proxy comments throughout.
- `src/lib/provit.ts:1,8`: `https://provit.getoffgridai.co` as the default base URL.

### Helper / ops scripts with real fleet topology

- `scripts/fleet-pool.mjs:22-29`: full node table with g1-g8 IPs, ports, model names.
- `scripts/metrics-dashboard.mjs:83-101,116-118`: full fleet dashboard with every node IP, hostname, role, ports (also carries the credentials above).
- `scripts/gateway-aggregator.mjs:130`, `scripts/cluster-gateway.mjs:35`: `HOST_HINT` default `127.0.0.1`.
- `scripts/shoot-walkthrough.mjs:2,7`, `w1verify.mjs:4,5,7,10`: `BASE` / URLs hardcoded to `http://127.0.0.1`.

### Test files with real IPs / hostnames

These assert against the real fleet map, so they need updating in lockstep when the runtime code is genericized.

- `test/display-host.test.ts`, `test/config-display.test.ts`, `test/data-quality.test.ts`, `test/vectordb-allowlist.test.ts`, `test/warehouse.test.ts`, `test/etl.test.ts`, `test/chat-audio.test.ts`, `test/keycloak-realm.test.ts`.

### Real user emails / PII

- `scripts/metrics-dashboard.mjs:102`: `mac@`, `mohammed.ali@`, `diksha.sharma@`, `ali@wednesday.is`.
- `scripts/shoot-*.mjs`, `scripts/shoot-walkthrough.mjs`, `w1verify.mjs`: `mac@wednesday.is` / `mohammed.ali@wednesday.is` as login users.

## SAFE TO GENERICIZE NOW (done, or owned by another agent)

- **Done in this pass** (public-facing files this agent owns): `CLAUDE.md:3` and `docs/ENGINEERING.md:97`. `127.0.0.1` / `192.168.1.60` replaced with `<control-plane-host>` / `<aux-host>`.
- **Fleet / on-prem docs**: `deploy/` and `deploy/onprem/*` (SERVER_STATE, SERVICE_MAP, DEPLOY, HANDBOOK, GATEWAY_PROVISIONING, seed scripts, compose files, and so on) carry the bulk of the IPs/hosts (~112 IP hits in `deploy/onprem/` alone). These are owned by the fleet-docs agent and/or excluded from the public repo per the release checklist's repo-split step. Not touched here.
- **Broader status/internal docs** carrying `*.getoffgridai.co` (the public product domain, plus `onprem-console.` / `provit.` subdomains): `docs/ROADMAP.md`, `docs/GAPS_BACKLOG.md`, `docs/VERIFICATION_GAPS.md`, `docs/SESSION_HANDOFF.md`, `docs/OPEN_ITEMS.md`, `docs/REGRESSION.md`, `docs/SERVICE_CAPABILITY_AUDIT.md`, `docs/FILE_STORAGE_API.md`, and `docs/research/*`. These are internal operational docs. The apex `getoffgridai.co` is the real public domain (not a secret), but the internal subdomains should be genericized or the docs kept private. Deferred to the supervised repo-split decision.

## KNOWN-CLEAN (false positives, no action)

- `public/scalar.standalone.js`: vendored, minified Scalar API-reference library (v1.62.4). Its lone `192.168.1.42` is example data inside the third-party bundle, not our infra.
- `oglb_` matches are all placeholders: `deploy/onprem/ragas-sidecar/.env.example:11` (`oglb_replace_with_real_gateway_key`) and two prose references in `SERVER_STATE.md` and the `.env.example` comment.
- `deploy/verify-integration.sh:260`: `Bearer garbage-not-a-real-token`, an intentional negative-test literal.

## Deliberately left for the supervised pass

- Runtime `.ts` fleet IPs/hosts (load-bearing): need an env/config seam before removal, then history scrub plus rotation.
- `.env.example`: co-owned, handled separately, not touched.
- git history rewrite and key rotation: supervised, out of scope for this working-tree pass.
- Fleet/on-prem docs genericization or repo-split: owned by the fleet-docs agent.
