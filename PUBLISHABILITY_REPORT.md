# Publishability Report

**Status: NOT YET SAFE TO PUBLISH.** This report enumerates exactly what must be
scrubbed, rotated, genericized, or moved out of the repo before it can go public.

> ⚠️ **This report is itself internal-only.** It cites real credentials, the
> tunnel id, and internal hosts by name so a human can act on them. Like
> `docs/SECRET_INVENTORY.md`, it must be excluded from the public repo (delete or
> keep in the private fleet repo after the supervised pass).

It is a **report only**. This pass performed the SAFE, reversible parts of
release-prep (community-health files, `.env.example` documentation). It did
**not** perform any history scrub, key rotation, repo-split, or in-tree
genericization of load-bearing runtime values — those are SUPERVISED steps,
enumerated below for a human to execute.

Companion documents (read together):

- [`docs/SECRET_INVENTORY.md`](docs/SECRET_INVENTORY.md) — the exhaustive,
  grouped, file:line inventory of every real credential and internal identifier
  in the working tree. This report references it rather than duplicating it.
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) — the gated checklist
  the human runs before publishing. This report maps to its SUPERVISED items.

---

## 1. Community-health files — DONE / verified in this pass

| File | Status | Note |
|---|---|---|
| `LICENSE` | ✅ present & correct | Verbatim GNU AGPL-3.0 (matches `license: AGPL-3.0-only`). |
| `README.md` | ✅ links & badges sane | All relative image/doc links resolve; CI + coverage + license + node badges point at `off-grid-ai/console`, consistent with `.github/workflows/ci.yml`. Content not rewritten (out of scope). |
| `CONTRIBUTING.md` | ✅ present | Build/test gates, coverage bar, CLA note, security pointer. |
| `CODE_OF_CONDUCT.md` | ✅ present | Contributor Covenant 2.1. **Contact is a placeholder** — see §5. |
| `SECURITY.md` | ✅ present | Responsible disclosure. **Contact is a placeholder** — see §5. |
| `CLA.md` | ✅ created this pass | Plain-language CLA summary + signing process; references the canonical CLA (no invented legal text). |
| `.github/ISSUE_TEMPLATE/` | ✅ created this pass | `bug_report`, `feature_request`, `config.yml` (routes security → private). |
| `.github/PULL_REQUEST_TEMPLATE.md` | ✅ created this pass | Gates + DRY/SOLID/no-secrets checklist. |

No blockers here.

---

## 2. MUST ROTATE — real credentials (assume compromised once public)

Rotate BEFORE public, then confirm the old value no longer grants access.
Full list in `docs/SECRET_INVENTORY.md` § "MUST ROTATE". Highest-severity, with
fresh evidence:

- **`changeme`** — real console / Keycloak user password, in cleartext, for
  real accounts (`*@example.com`). Appears in committed scripts:
  - `deploy/onprem/recover.sh:94` (printed in the health report)
  - `deploy/onprem/recover.sh:96` (used in a live token request as
    `username=mac@example.com -d password=changeme`)
  - plus `scripts/shoot-*.mjs`, `scripts/metrics-dashboard.mjs:102`,
    `w1verify.mjs:6`, `docs/SESSION_HANDOFF.md:168` (see inventory for the full
    17-occurrence list).
- **`admin` / `offgrid-dev`** — Keycloak admin console credential, shown live in
  `scripts/metrics-dashboard.mjs:101` and defaulted in
  `scripts/keycloak-setup.sh:10`.
- **DEV fall-open defaults** (`offgrid-dev-token`, `offgrid-dev-signing-key`,
  `offgrid-dev-keycloak-secret`): documented dev placeholders, NOT production
  secrets — but if any on-prem deployment ever ran without overriding them, the
  effective value equals the placeholder and MUST be rotated. Confirm production
  overrides all of them (see inventory § note).

---

## 3. MUST SCRUB — real internal topology (tree AND git history)

These are not secrets that grant access, but they leak the private fleet
topology and internal endpoints. Removing them from the tree is **not enough**:
they are also in git history, so the SUPERVISED history-rewrite step is
required. Full grouped list (runtime code, ops scripts, tests, docs) in
`docs/SECRET_INVENTORY.md` §§ "MUST SCRUB". Categories and scale:

- **LAN IPs** `127.0.0.1` (control-plane / S1), `192.168.1.60` (aux / S2),
  and the `g1`–`g8` node IPs — ~254 occurrences across ~54 files.
- **Internal mDNS hostnames** `offgrid-s1.local`, `offgrid-s2.local`,
  `g6.local`, etc. — ~237 matches.
- **Internal service subdomains** on `getoffgridai.co`
  (`onprem-console.`, `provit.`, `gateway.`, `ai.`, `hooks.`) — ~240 matches.
  Note: the apex `getoffgridai.co` is the real PUBLIC product domain (not a
  secret); the internal SUBDOMAINS are what must be genericized or kept private.
- **Cloudflare tunnel id** `70f8a607-…-016022f9f493` and its credentials-file
  path — `deploy/onprem/cloudflared-tunnel.yml:11-12`.
- **Load-bearing runtime `.ts` IPs/hosts** (in `src/`, another agent's scope —
  reported, not touched): `src/lib/display-host.ts`,
  `src/lib/data-domains-demo-seed.ts:64,67` (`DS_HOST = '127.0.0.1'`),
  `src/lib/services-directory.ts`, `src/lib/provit.ts:8`, `src/lib/etl-model.ts:6`.
  These need an env/config seam before removal (blanking them breaks the app) —
  SUPERVISED.

### Real user emails / PII (scrub)

- `scripts/metrics-dashboard.mjs:102`, `scripts/shoot-*.mjs`, `w1verify.mjs`:
  `mac@example.com`, `mohammed.ali@example.com`, `diksha.sharma@…`,
  `ali@example.com` (~10 occurrences under `scripts/` + `w1verify.mjs`).

---

## 4. Internal-only files — should be gitignored, moved to a private repo, or excluded by the repo-split

The public repo should not carry the fleet's operational runbooks and internal
planning docs. Recommend a **repo split**: fleet/on-prem lives in a separate
private location (RELEASE_CHECKLIST § "Supervised final pass" step 1).

**Fleet / on-prem operational (private):**
- `deploy/onprem/**` — **62 committed files**: `SERVER_STATE.md`, `SERVICE_MAP.md`,
  `HANDBOOK.md`, `GATEWAY_PROVISIONING.md`, `DATA_PLANE.md`,
  `cloudflared-tunnel.yml`, `dns-records.sh`, `recover.sh`,
  `oauth2-proxy-run.sh`, the `oidc/*` configs, `seed-*.mjs`, and the
  `*.plist`/compose files. These carry the bulk of the IPs, hosts, tunnel id,
  and the real cred in §2.
- `deploy/DEPLOY.md`, `deploy/Caddyfile`, `deploy/docker-compose.yml`,
  `deploy/push.sh`, `deploy/smoke-prod.sh`, `deploy/verify-integration.sh` —
  reference the control-plane host; review before publishing.

**Internal planning / status / session docs (private or genericize):**
- `docs/SESSION_HANDOFF.md`, `docs/SECRET_INVENTORY.md` (this is an internal map
  of secret locations — do NOT ship it public), `docs/VERIFICATION_GAPS.md`,
  `docs/BHARAT_TENANT_PLAN.md`, `docs/USE_CASES_PLAN.md`,
  `docs/research/NETWORK_TOPOLOGY.md`, `docs/research/API_CATALOG.md`,
  `docs/research/GATEWAY_DEEP_AUDIT.md`, `docs/OPEN_ITEMS.md`, `docs/REGRESSION.md`,
  `docs/ROADMAP_STATUS.md`.

**Root helper committed but internal:**
- `w1verify.mjs` — hardcodes `127.0.0.1` + real creds/emails. Delete or
  gitignore; not a public artifact.

**`CLAUDE.md`** — committed, and it is the internal operating guide (references
the control-plane host, deploy internals, the multi-agent model). Decide whether
to keep a genericized public version or move it private. The workspace `CLAUDE.md`
IP references were already genericized (`<control-plane-host>`); confirm the
console `CLAUDE.md` carries no raw IPs before publishing.

**Already gitignored (good):** `deploy/onprem/CREDENTIALS.md`,
`deploy/onprem/ragas-sidecar/.env`, `.env*.local`, `.env.production`.

---

## 5. `.env.example` — status + FLAGS for the orchestrator

**Completeness (DONE this pass):** every env var the app reads
(`process.env.*` and the `env.*` helper — 159 vars total) now has a documented
placeholder entry with a comment in `.env.example`. Additions use GENERIC
placeholders only (`https://your-*.example.com`, `changeme`) — no real value was
introduced. Pre-existing lines were left untouched.

**FLAGGED — real values in the PRE-EXISTING `.env.example` (NOT edited inline;
genericizing committed real values is a SUPERVISED step):**

| Line | Value | Why it is flagged |
|---|---|---|
| `.env.example:40` | `OFFGRID_PROVIT_URL=https://provit.getoffgridai.co` | Real internal service subdomain as the default. Genericize to `https://your-provit.example.com`. |
| `.env.example:54` | `OFFGRID_TEMPORAL_ADDRESS=offgrid-s1.local:7233` | Real internal mDNS hostname (S1). Genericize to `your-temporal-host:7233`. |
| `.env.example:28` | comment: `e.g. http://127.0.0.1:8800` | Real control-plane LAN IP in a comment. Genericize to `http://your-gateway-host:8800`. |
| `.env.example:23`, `:36` | `offgrid-dev-keycloak-secret` | Documented DEV fall-open secret (see §2). Acceptable as a labelled dev default, but confirm production overrides it; consider `changeme`. |

These four are the only real-ish values remaining in `.env.example`; all newly
added entries are clean.

---

## 6. Known-clean (no action — recorded to prevent re-flagging)

- `public/scalar.standalone.js` — vendored minified third-party library; its
  lone `192.168.1.42` is example data inside the bundle, not our infra.
- `oglb_…` matches — all placeholders
  (`deploy/onprem/ragas-sidecar/.env.example:11` = `oglb_replace_with_real_gateway_key`).
- `deploy/verify-integration.sh:260` — `Bearer garbage-not-a-real-token`, an
  intentional negative-test literal.
- All entries added to `.env.example` in this pass — generic placeholders only.

---

## 7. SUPERVISED steps required before public (cannot be automated)

In order, per `docs/RELEASE_CHECKLIST.md` § "Supervised final pass":

1. **Split the repo from the fleet.** Move everything in §4 to a private
   location; confirm the public repo does not carry it.
2. **Genericize the `.env.example` real values** in §5 and any remaining
   runtime `.ts` topology in §3 (behind an env/config seam).
3. **Scrub git history** of every MUST-SCRUB item (§3) and MUST-ROTATE literal
   (§2), using `docs/SECRET_INVENTORY.md` as the checklist. Force-push,
   re-verify from a fresh clone.
4. **Rotate** every credential in §2. Confirm old values no longer grant access.
5. **Set real security contacts** in `SECURITY.md` and `CODE_OF_CONDUCT.md`
   (replace the `example.com` placeholders).
6. **Final clean-clone audit** — fresh clone, re-run the secret scan from
   scratch; nothing sensitive in tree or history.

Until steps 1–6 are complete and verified, the repository must remain private.
