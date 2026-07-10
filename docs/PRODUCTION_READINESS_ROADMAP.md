# Production Readiness Roadmap

The honest path from "strong engine, gated" to "public launch." Status is reported as a gate:
**code** (written) / **wired** (integrated) / **verified** (proven live). Nothing is "done" until verified.

Last updated: 2026-07-10.

---

## Done (this session, on main + deployed)

- **Quality spine, enforced local + CI:** typecheck, coverage >=85% (all dims), dependency-cruiser
  (no-circular verified 0 dangerous cycles + arch boundaries), jscpd (DRY, 2.08%), production build.
- **hygiene = quality-as-code:** the skill now has a SETUP mode; run it in any fresh repo to install
  the whole spine (Wednesday web/RN baselines + all the gates).
- **LLM Guard** is the sole authoritative content guardrail, fail-closed, India recognizers folded
  in — verified live on the fleet (masked a real PAN + secret).
- **LiteLLM** router replaces the hand-rolled aggregator (code merged; live cutover pending).
- **Native BI** — Superset iframe removed, native charts (verified render).
- **Builder** schedule triggers + output-sink delivery (email/report) landed.
- **Fleet MDM control** honestly marked coming soon everywhere.
- **SEC-P1** — 5 cross-tenant IDORs org-scoped, secret-GET leak + error leaks fixed, red-first tests.
- **Release files** (LICENSE / CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / RELEASE_CHECKLIST) +
  `docs/SECRET_INVENTORY.md`.
- **Deploy:** current main deployed to onprem-console; killed a 3-day-old stale root process that was
  serving old code and causing Cloudflare 502s.

---

## Phase 1 - Deploy reliability + live verification (FOUNDATIONAL, do first)

The deploy works but the fleet's process supervision is fragile. Make it reliable before anything
rides on it.

- **P1.1 Consolidate the console to ONE supervisor.** Today a stale/duplicate (sometimes root-owned)
  `next-server` can hold `:3000` and serve OLD code (root cause of today's 502 outage; 684 EADDRINUSE
  lines in the log). Fix `deploy/push.sh` to restart via `launchctl kickstart` (NOT pkill+nohup),
  detect + clear any stale/duplicate process (incl. root-owned) before start, and confirm exactly one
  process serves the new build. Document the gotcha in `deploy/onprem/SERVER_STATE.md` + `deploy/DEPLOY.md`.
- **P1.2 Post-deploy live verify.** After every deploy, run the live capture harness + a smoke that
  proves: new build is serving (build id), a governed run works, LLM Guard screens in-path
  (G-LG-3, still open), LiteLLM cutover if flipped. Nothing "done" until this passes.
- **P1.3 Dead-link checker** (linkinator or lychee) crawling the LIVE site in CI + pre-deploy. Would
  have caught today's `/api/v1/specs/*` 502 links automatically. Add to the gate.
- **P1.4 Specs-route edge behavior.** `/api/v1/specs/[service]` returns 502 when a backing service is
  down, which Cloudflare replaces with its host-error page. Return 200 + an availability payload
  (or a status the edge does not intercept) so an unreachable optional service never reads as a site
  outage.
- **P1.5 LiteLLM live cutover.** Bring LiteLLM up on the fleet, repoint the model door, verify LB /
  failover / logging end to end. Aggregator code is already retired on main.

## Phase 2 - The public read-only live demo (THE LAUNCH MOVE)

Anyone hits a link, logs in with hellobar-surfaced read credentials, sees the WHOLE platform working
live across two seeded tenants. View everything, write nothing.

- **P2.1 Read-only VIEWER role (RBAC).** View every surface INCLUDING admin views; block all
  create / update / delete / trigger at the policy layer; hide or redact every secret value. Enforce
  server-side (not just hidden UI), and disable/annotate write controls in the UI.
- **P2.2 Two tenants seeded rich + tour-worthy:** mock bank (bharatunion) at
  `bharatunion-onprem-console.getoffgridai.co` and mock insurer (Suraksha) at
  `suraksha-onprem-console.getoffgridai.co` - apps, agents, pipelines, connectors, runs, governance,
  analytics all populated.
- **P2.3 Demo viewer creds per tenant** with the viewer role + admin-view-no-secrets.
- **P2.4 Hellobar** (top banner) on each demo instance surfacing the read-only creds so visitors
  self-login. No auto-login needed.
- **P2.5 Fresh live screenshots** across both tenants via the harness, wired into the README so
  people feel it before they click.
- **P2.6 Demo link** front-and-center in the README + landing.
- **Verify:** log in as viewer, confirm cannot write anything and no secret is visible; capture proof.

## Phase 3 - Aggressive gate + code hygiene

- **P3.1 (#226) Aggressive static-analysis pass:** typed-ESLint dead-branch rules
  (`@typescript-eslint/no-unnecessary-condition` + no-unreachable + no-constant-*), knip (dead
  files/exports/deps), gitleaks (secret scan - release-critical), audit-ci (dep vulns), and the
  dependency-cruiser aggressive ratchet (burn down the 4 type-only cycles + orphans, then WARN->ERROR
  + broaden pure-lib / DIP / components boundaries).
- **P3.2 err.message leak follow-up** - ~55 remaining `(err as Error).message` responses genericized
  via a shared helper (flagged during SEC-P1).
- **P3.3 api-docs density** - the `/operations/api-docs` page has tabs; reduce in-tab scrolling
  (sub-grouping / collapse), and mark Fleet MDM endpoints coming-soon consistently.

## Phase 4 - Functional completeness (the vision gaps)

- **P4.1 Set-once org-governance admin write-path (BIGGEST PRODUCT GAP).** Today org defaults are
  hardcoded constants (`ORG_POLICY_DEFAULTS` / `ORG_GUARDRAIL_DEFAULTS`); the INHERIT half is real but
  an admin cannot set the org's rules once from the console. Build the store + admin UI so "set your
  rules once, everyone inherits" is actually operator-facing. This is the core of the pitch.
- **P4.2 Lineage auto-emit** on every run (the OpenLineage/Marquez exporter exists but is not
  triggered from the run path) + correlate eval scores + citations into the audit event.

## Phase 5 - Publishability (SUPERVISED, irreversible - needs explicit go)

- **P5.1** Create private `console-onprem-fleet` repo; move all internal fleet/ops content; wire as a
  git submodule.
- **P5.2** Rewrite git history (filter-repo) to purge secrets/IPs per `docs/SECRET_INVENTORY.md`;
  force-push (breaks existing clones - deliberate, supervised).
- **P5.3** Rotate the leaked `oglb_` gateway key + the dev-default credentials named
  in SECRET_INVENTORY.
- **P5.4** Genericize `.env.example` + both `CLAUDE.md` (internal IPs / hosts).
- **P5.5** Landing page inherits the README philosophy + deployed (IN PROGRESS).

## Phase 6 - "Battle-tested" proof (earns the claim) - ON HOLD

**DO NOT START. Founder-gated.** The insurer 15 use cases are explicitly on hold (2026-07-10). The founder
will test the 2 apps already built + pushed, give feedback, we act on that feedback first, and only
then - on the founder's explicit go - do we consider the insurer set. Do not author insurer use cases until told.

- **P6.1 (#207/#216) [HOLD]** Author + auto-test the insurer 15 use cases via the real NL builder path in
  Suraksha - blocked on founder feedback on the 2 existing apps + an explicit go-ahead.
- **P6.2** A golden thread: one real use case exercised through every wired service, verified.

---

## Honest posture

The engine is production-grade and honest: security (isolation + SEC-P1 + fail-closed guardrails),
quality gates (local + CI), and a real governed value chain. The gaps to a public launch are known
and scoped, not vague: **deploy reliability (Phase 1)** and **the read-only demo (Phase 2)** are the
near-term blockers; **set-once org-gov (P4.1)** is the one real product gap; **publishability
(Phase 5)** is the supervised, irreversible finish. None of it is a mystery.
