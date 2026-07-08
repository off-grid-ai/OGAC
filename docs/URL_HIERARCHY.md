# T6 — RESTful URL hierarchy (section / subservice / entity / detail)

**Founder ask (2026-07-08):** URLs must read RESTfully — `section/subservice/entity/[id]` — so a path
communicates where a resource lives, instead of today's flat standalone slugs (`/integrations`,
`/policy`, `/analytics`). Scope: **ALL sections, section-named segments**, with **301 redirects** from
every old flat URL (URLs are a contract — bookmarks, deep-links, doc screenshots must not break).

**Run AFTER T2/T3 land** — this touches the same nav + link + page files; running in parallel = merge hell.

## Why it's mostly mechanical
Routes already live under route-GROUP folders whose parens hide the segment:
`src/app/(console)/(data)/integrations/…` → URL `/integrations`. Rename the folder `(data)` → `data`
(drop the parens) and every child becomes `/data/…` automatically. Real work = per-route renames,
landing renames, updating the module registry + all internal `href`s + nav active-matching + redirects.

## Target mapping (old → new)
**Home:** `/overview` stays (also `/` → overview).

**Workspace** — `(workspace)` → `workspace`:
- `/chat`→`/workspace/chat` · `/knowledge`(+`/[id]`)→`/workspace/knowledge/[id]` · `/storage`→`/workspace/storage`
- `/projects`(+`/[id]`)→`/workspace/projects/[id]` · `/prompts`→`/workspace/prompts` · `/artifacts`→`/workspace/artifacts`

**Build** — `(build)` → `build`:
- `/studio`→`/build/studio` · `/apps/[id]`→`/build/apps/[id]` · `/agents`(+`/[id]`)→`/build/agents/[id]`
- `/pipelines`(+`/[id]/*tabs`)→`/build/pipelines/[id]/*` · `/brain`→`/build/brain` · `/tools`→`/build/tools`
- `/evals`→`/build/evals` · `/sandbox`→`/build/sandbox`

**Gateway & Fleet** — `(gateway)`? currently ungrouped flat routes → `gateway`. RESOLVES the audit's
AI-Gateway/Gateways/Services IA overlap (C-audit):
- `/services`→`/gateway/services`
- `/gateway` (the AI-Gateway aggregator/model hub) → `/gateway/ai` (or `/gateway/router`)
- `/gateways` (first-class registry list) + `/gateways/[id]` → `/gateway/registry` + `/gateway/registry/[id]`
- `/fleet`(+`/[id]`)→`/gateway/fleet/[id]` · `/edge`→`/gateway/edge`

**Data** — `(data)` → `data` (the section you flagged):
- `/integrations`→`/data/integrations` · `/connectors/[id]`→`/data/connectors/[id]` (list at `/data/connectors`)
- `/data-domains`(+`/[id]`)→`/data/domains/[id]` · `/retrieval`→`/data/retrieval` · `/lineage`→`/data/lineage`
- `/data` landing stays `/data`.

**Governance** — `(governance)` → `governance`; landing rename `control` → `/governance`:
- `/control`→`/governance` · `/policy`→`/governance/policy` · `/access`(+`/[id]`)→`/governance/access/[id]`
- `/guardrails`→`/governance/guardrails` · `/secrets`→`/governance/secrets` · `/regulatory`→`/governance/regulatory`
- `/provenance`→`/governance/provenance`

**Insights** — `(insights)` → `insights`; landing rename `observability` → `/insights`:
- `/observability`→`/insights` · `/analytics`→`/insights/analytics` · `/drift`→`/insights/drift`
- `/finops`→`/insights/finops` · `/accounting`→`/insights/accounting` · `/reports`→`/insights/reports`
- `/siem`→`/insights/siem` · `/audit`→`/insights/audit`

**Operations** — → `operations`:
- `/admin`→`/operations/admin` · `/config`→`/operations/config` · `/backups`→`/operations/backups`
- `/api-docs` / `/docs` playground: keep `/docs` (public-facing doc site — NOT nested).

## Implementation checklist (for the T6 agent)
1. **Source of truth:** `src/modules/registry.ts` route strings → new paths; `src/modules/groups.ts`
   `PATH_ALIASES` + any route-prefix logic updated; `sidebarActiveIdForPath` still resolves.
2. **Move folders:** rename group folders `(x)`→`x`; move flat routes into their section; rename
   `data-domains`→`domains`, landings `control`→(index of governance), `observability`→(index of insights).
   Keep each section's `layout.tsx` (the SubNav) with the group.
3. **Internal links:** `rg` every hard-coded `href="/old"` / `router.push('/old')` / `redirect('/old')`
   across `src/` → new path. Nav components (`*Nav.tsx`), breadcrumbs, cross-links, quick-actions.
4. **Redirects:** `next.config.mjs` `redirects()` (301, permanent) for EVERY old flat path → new
   (incl. `/:id` param forms). This keeps bookmarks/docs/screenshots working.
5. **Active-state:** the SubNav/sidebar active matching keys off pathname — verify each tab highlights
   under the new nested paths.
6. **Docs:** the doc screenshots reference old URLs in copy only (images are fine); update any URL text.
7. **Gate + verify:** typecheck/test/build; then live-nav every section + hit 5–6 old URLs and confirm
   they 301 to the new ones. This is the highest-blast-radius change — screenshot-verify each section.

Prefer ONE careful agent (worktree) that owns the whole move so links + redirects + registry stay
consistent in a single commit; a fan-out would splinter the link graph.
