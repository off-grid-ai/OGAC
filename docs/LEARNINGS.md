# LEARNINGS — hard-won gotchas (read before you start, append when you hit one)

Append-only log of non-obvious things that cost someone time. **Every agent: grep this file before starting work; append any new gotcha the moment you hit it** (mid-task, not batched at the end — your run may die first, and a parallel agent may hit the same wall while you work). One entry = the trap + the WHY + the fix. Newest at top of each section.

Cross-session design decisions and fleet realities live in the orchestrator's auto-memory; this file is the in-repo mirror for anything a subagent needs and can't see there.

## Build / deploy

- **A DB schema change breaks "just redeploy" — treat it as the exception, not the default.** Most console work is UI + API + `src/lib` and ships with a plain `next` redeploy. A `src/db/schema.ts` change does NOT: `drizzle-kit push` HANGS over SSH on the fleet, so the DDL must be hand-applied to Postgres with the `pg` client. Rules when a schema change is genuinely needed: (1) additive + nullable/defaulted ONLY — never a NOT-NULL-without-default column, never a drop/rename (must be safe on populated rows, forward-only); (2) don't hack data into a semantically-unrelated existing jsonb column just to dodge DDL — that hurts the code more than the migration costs; (3) commit the EXACT idempotent SQL (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`, `CREATE INDEX IF NOT EXISTS …`) alongside the change so applying it on deploy is a 5-second paste, matching your drizzle column defs exactly.
- **Build ON the server before restart — local node hides a real prod failure.** Circular imports produce a TDZ crash only under the server's node22; local node26 masks it. `npm test`/`typecheck` do NOT catch build/route errors — always run `npm run build` before calling work done and before deploy.
- **Never full-`push.sh` per edit ("no more 8-minute bullshit").** Iterate via `next dev` hot-reload on the box (port 3005, rsync src → recompile in seconds). Run the full production build ONCE per slice, at the end.
- **A deploy can silently no-op.** `git` is dead on the server (no Xcode CLT) so `git pull` fails silently — deploy via rsync (`push.sh`), never git. The `shared/` monorepo must be rsync'd too or `@offgrid/*` file: deps fail with "Module not found". Non-interactive SSH has a minimal PATH — call node by absolute path.
- **`git push` can exit 0 having pushed nothing** when the branch has no upstream. Confirm `git rev-parse HEAD == git rev-parse origin/main` after pushing.

## Tests / coverage

- **Coverage bar is ≥85% on branches/statements/lines/functions/conditions**, enforced by the pre-push hook (`npm run coverage:check`). Measured on the unit-testable logic layer (`src/lib` pure logic + adapters' pure paths); pure-I/O glue and `.tsx` are excluded and verified by integration + build + vision instead. A file that's hard to cover usually needs a cleaner pure/I/O seam.
- **No mocks of our own code.** Mock only at the true device/IO boundary (outbound HTTP/socket, DB client). Assert the terminal artifact, not an intermediate call. If you're mocking a lot, the code needs a cleaner seam.

## Verification protocol — the loop every landed feature closes

Founder standing instruction (2026-07-22): "keep ensuring deep verification with screenshots; update the operations/services-capability-map URL properly." A feature is not done at green tests + build. Close this loop for EVERY landed capability:
1. **Screenshot-verify live** — run the authed UI harness (`next dev` + programmatic `/api/auth/callback/dev` login + Playwright), exercise the REAL path (not a probe), capture the terminal artifact. Save shots to `console/docs/screenshots/capabilities/`.
2. **Update the capability map at its canonical URL** — the map lives at `/operations/services/capability-map`, composed in `src/lib/service-capability-map.ts` from family modules `src/lib/service-capabilities/*.ts`. Add/update the capability's entry there with HONEST gate statuses (code / wired / verified — c8-style yes/partial/no) and an `evidence` string citing the exact run/ids + screenshot. NEVER flip a gate to verified without live evidence. If a landed capability has no home family module, add it to the right one (or a new family) — don't leave the map lying by omission.
3. **Confirm the URL renders** the new/updated entry (screenshot the map page too).

## Verification honesty (recurring defect)

- **A probe/badge/row-existing ≠ enforced.** Exercise the REAL path and read the terminal artifact before flipping any capability gate. Restart the agent-worker too after env changes (not just the console). Dollar-budgets are $0 no-ops on free models.
- **Report status as a gate — code / wired / verified.** "Done" means VERIFIED live, not merely merged. A premature "complete" is a defect.

## Architecture invariants

- **Consumption hierarchy (governing):** agent/app → pipeline → gateway → model, no skips. Internal services (eval judge, grounding, guardrails) must be agents/apps on a pipeline, never pin a model directly.
- **Outbound sinks reuse ONE governance rail:** shadow-mode dry-run → egress leash → PII-mask-before-send → honest-degrade → ed25519 signed receipt. New sinks plug into it (pattern: `src/lib/adapters/sinks/email-resend.ts`); never fake success when unconfigured.
- **Navigation lives in the URL/history** (route + searchParams), never client-only `useState` for a navigational position. Every entity collection is list → deep-linkable detail. Every module is full CRUD, not a read-only dashboard.
- **Per-tenant values in the shared layout key off the signed-in org** (`currentTenantSlug`), NOT `headers().get('host')` — host flaps during client RSC nav.
