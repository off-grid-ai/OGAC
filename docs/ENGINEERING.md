# Engineering Standards

These rules are non-negotiable. Every engineer who touches this codebase must read and follow them before writing a single line of code. The architecture is deliberate — deviating from it creates technical debt that cannot be cleanly removed.

---

## The Architecture You Must Understand First

Off Grid Console is not a collection of pages. It is a **module system** sitting in front of a set of headless services. Every surface you see in the console is a **thin UI layer** over an API-first backend. Nothing in the UI should contain business logic.

```
User → Module UI → /api/v1/<module>/* → Adapter → Headless Service
```

The five planes:

| Plane | What it means |
|---|---|
| **Data** | Capture, connectors, ingest, PII masking |
| **Intelligence** | Gateway, brain, agents, studio |
| **Governance** | Control, regulatory, lineage, FinOps |
| **Observability** | Analytics, observability, reports |
| **Platform** | Fleet, access, admin, storage |

Before touching a module, understand which plane it belongs to and what headless service it fronts.

---

## Non-negotiable Rules

### 1. Never put service logic in a component or page

Pages and components fetch from `/api/v1/*`. They do not talk to Postgres, Keycloak, Qdrant, OpenSearch, or any other backing service directly.

**Wrong:**
```ts
// In a React component
const res = await fetch(`http://127.0.0.1:6333/collections`); // ❌
```

**Right:**
```ts
// In a React component
const res = await fetch('/api/v1/vectordb'); // ✅ — routes through the adapter
```

### 2. All backing service calls go through adapters

The adapter layer lives in `src/lib/adapters/`. Every swappable backing service must have an adapter. Adapters are the only place where environment variables for service URLs are read.

If you are writing `process.env.OFFGRID_*_URL` anywhere outside of `src/lib/adapters/`, `src/lib/`, or an API route — stop.

### 3. API routes are thin

An API route (`src/app/api/v1/*/route.ts`) does exactly three things:

1. Authenticate + authorize (`requireUser`, `requireAdmin`)
2. Parse + validate the request
3. Call an adapter or lib function and return the result

No business logic lives in the route handler.

### 4. One module, one route prefix, one service

Each module in `src/modules/registry.ts` maps to exactly one `service`. That service is the only thing the module's API routes call. If a module needs data from two services, one of those is the canonical service — the other is a dependency.

### 5. Register before you wire

If you are adding a new module:

1. Add the `ModuleId` to `src/modules/registry.ts`
2. Add the `ModuleDef` to `MODULES` (with `id`, `label`, `description`, `route`, `service`)
3. Add the icon to `src/modules/icons.tsx`
4. Create `src/app/(console)/<module>/page.tsx` — starts with `requireModuleForUser('<module>')`
5. Create the component in `src/components/<module>/`
6. Create API routes in `src/app/api/v1/<module>/`

Skipping steps 1-3 means the module is invisible to the access control system, the services directory, and the navigation. It is effectively rogue.

### 6. No hardcoded service URLs in components or pages

Service URLs come from environment variables, read in `src/lib/` or `src/lib/adapters/`. The default fallback to `127.0.0.1` is for local dev only. Production deployments must set all `OFFGRID_*_URL` vars in the deployment environment.

### 7. Auth is handled by the framework — never bypass it

- Server components: use `requireModuleForUser` or `requireAdmin` from `src/lib/module-access.ts`
- API routes: use `requireUser` or `requireAdmin` at the top of every handler
- Never access `session` manually without going through these helpers
- Never skip auth for "internal" routes — there are no internal routes

### 8. Database access belongs in `src/lib/` not in API routes

Write a function in `src/lib/`. Call that function from the API route. This keeps database logic testable without spinning up a Next.js server.

### 9. Environment parity

Code written against the local docker-compose stack (`deploy/docker-compose.yml`) must work identically against the on-prem fleet (`<control-plane-host>` / `<aux-host>`). If it only works locally, it is not done.

### 10. No new top-level pages without a module registration

If you find yourself creating `src/app/(console)/something/page.tsx` without a corresponding entry in `src/modules/registry.ts`, stop. That page will be:
- Unprotected (no module access check)
- Invisible to the services directory
- Outside the nav system
- Outside the multi-tenant access model

Every surface is a module. Every module is in the registry.

---

## File Layout (what goes where)

```
src/
  app/
    (console)/          ← page shells only — no business logic
    api/v1/             ← thin route handlers — auth + parse + call lib
  components/           ← dumb UI — fetches from /api/v1, no direct service calls
  lib/
    adapters/           ← swappable service adapters (inference, grounding, evals, …)
    auth/               ← token verification, session helpers
    module-access.ts    ← requireModuleForUser, requireAdmin
    *.ts                ← business logic, DB queries, service clients
  modules/
    registry.ts         ← ModuleId union + MODULES array — single source of truth
    icons.tsx           ← MODULE_ICONS map — must stay in sync with registry
```

---

## Before You Start Any Task

1. **Read `src/modules/registry.ts`** — understand what modules exist and what service each fronts.
2. **Read `docs/ROADMAP.md`** — understand which phase the work belongs to.
3. **Read `src/lib/module-access.ts`** — understand how auth works before writing a route.
4. **Check whether an adapter exists** for the service you're calling (`src/lib/adapters/`). If not, create one — don't inline the call.
5. **Check whether the env var is documented** in `.env.example`. If you're adding a new dependency, add its var there too.

---

## What "Done" Means

A task is done when:
- TypeScript compiles clean (`npm run build` passes)
- The module is registered and accessible via the module system
- The API route is authenticated
- The env var is in `.env.example` with a comment
- It works against the on-prem fleet, not just localhost
