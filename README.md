# Off Grid Console

The **org-side web UI for the common control plane** — Fleet Control + Gateway/Brain admin.
The "app that connects to all the nodes" (Off Grid Desktop / Mobile). Next.js, on-prem,
local-first. See `../desktop/docs/CONSOLE_PLAN.md` for the full plan.

This is **M0**: the shell + module registry + a mocked fleet. Auth (OIDC) and Postgres land
in M1.

## Modular by design — run only what you bought

Everything is **API-first and independently adoptable**. A customer takes any subset:

- **Just the API** — Gateway / Brain / Agents are headless services (the Console is only one
  consumer of the same API; see `src/app/api/`).
- **API + UI** — this Console over any subset of services.
- **Just the Agents** — the pre-built AI agent use cases, standalone.
- **Just the Brain** — the ingestion→retrieval (RAG) pipeline, standalone.
- **All of it.**

Modules are toggled per deployment via `NEXT_PUBLIC_OFFGRID_MODULES` (see `.env.example`).
The sidebar shows only enabled modules; a disabled module's route returns 404
(`requireModule` in `src/lib/modules.ts`). The registry lives in `src/modules/registry.ts`.

```bash
# run only Fleet + Control
NEXT_PUBLIC_OFFGRID_MODULES=fleet,control npm run dev
# run everything (default)
npm run dev
```

## Standards

- **Visual:** Off Grid brutalist — Menlo mono, single emerald accent, flat, no gradients, no
  decorative animation (`../desktop/docs/DESIGN.md`).
- **Engineering (Wednesday Standards Kit):** cyclomatic complexity < 8, no `console.log`,
  strict import order, PascalCase components / camelCase logic. Enforced via `.eslintrc.json`.
- **Components — never custom.** Discover in the catalog
  (`wednesday-solutions/component-library-animations`), source the real component from its
  library (shadcn / Aceternity / Magic UI / Motion Primitives), re-theme to the brand. The
  catalog is cloned into `vendor/` for discovery only and is gitignored:

  ```bash
  git clone https://github.com/wednesday-solutions/component-library-animations vendor/component-library-animations
  ```

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint
npm run typecheck
npm run format:check
```

## Layout

```
src/
  app/
    (console)/            # the authed shell (sidebar + main)
      fleet|control|data|brain|agents|regulatory/page.tsx
    api/v1/devices/       # headless API (the "just the API" contract)
  components/             # Sidebar, ModuleHeader, Placeholder
  lib/                    # modules (enablement/guard), mock data
  modules/registry.ts     # the module registry — the heart of modularity
```
