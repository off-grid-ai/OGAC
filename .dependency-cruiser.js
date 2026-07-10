// Off Grid Console — dependency-cruiser ruleset.
//
// WHY THIS EXISTS. Two classes of defect keep hurting us, and neither is caught
// by typecheck or tests:
//
//   1. Circular imports that break the PROD build only. We shipped a TDZ crash
//      from a circular import that ran fine locally (Node 26) but crashed on the
//      server (Node 22). `no-circular` is the load-bearing rule here — it catches
//      that in CI/pre-push BEFORE a deploy.
//
//   2. Architecture boundary drift. CLAUDE.md + docs/ENGINEERING.md mandate a
//      ports-and-adapters shape: pure policy/logic in `src/lib` (zero-IO,
//      unit-testable), thin route handlers in `src/app`, swappable backends behind
//      `src/lib/adapters`. Until now that was enforced only by human review. The
//      boundary rules below make it mechanical.
//
// SEVERITY POLICY. Rules that pay off and are CLEAN today are `error` (they block
// the push / fail CI). Aspirational hygiene rules that would need a backlog burn-
// down are `warn` (visible, not blocking). See the baseline in docs/GAPS_BACKLOG.md.
// As of adoption the whole repo is clean on every boundary rule below, so they are
// all `error` — the ratchet is already at the top.

module.exports = {
  forbidden: [
    // ── 1. THE LOAD-BEARING RULE ────────────────────────────────────────────
    //
    // WHY TWO RULES. The prod-build TDZ crash is caused specifically by an EAGER
    // VALUE import cycle — module A `import { x }` from B and B (transitively)
    // eagerly imports A, so at init time one side sees an uninitialised binding.
    // A `type`-only import is erased before it runs, and a dynamic `import()` is
    // resolved lazily at call time — NEITHER can cause the TDZ crash, and both are
    // the standard, correct ways to break a cycle (this codebase already uses the
    // dynamic-`import('@/lib/adapters/registry')` pattern deliberately). So:
    //
    //   • `no-circular` (ERROR) counts a cycle ONLY if it can be formed from eager
    //     value edges — excludes both dynamic-import and type-only edges. This is
    //     the exact TDZ-dangerous class. Baseline: 0 → ratchet is already at the top.
    //   • `no-circular-type-only` (WARN) is the broader hygiene net: cycles closed
    //     only through `import type` edges. Harmless at runtime but still coupling
    //     worth burning down. Baseline: 4 (see docs/GAPS_BACKLOG.md) → WARN, not
    //     blocking, so the backlog doesn't gate every push.
    {
      name: 'no-circular',
      comment:
        'Eager VALUE import cycle — the exact cause of the TDZ crash that surfaces ' +
        'only in the prod build (Node 22 server) while passing locally (Node 26). ' +
        'Dynamic import() and type-only edges are excluded (they cannot cause TDZ ' +
        'and are the correct ways to break a cycle). ERROR. Baseline: 0.',
      severity: 'error',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['dynamic-import', 'type-only'] },
      },
    },
    {
      name: 'no-circular-type-only',
      comment:
        'Broader hygiene net: import cycles that close only through type-only edges ' +
        '(erased at build → runtime-safe, so NOT the TDZ bug) or eager value edges. ' +
        'Dynamic import() still excluded. WARN — 4 existing type-only cycles are a ' +
        'known baseline logged in docs/GAPS_BACKLOG.md; ratchet to ERROR once burned down.',
      severity: 'warn',
      from: {},
      to: {
        circular: true,
        viaOnly: { dependencyTypesNot: ['dynamic-import'] },
      },
    },

    // ── 2. ARCHITECTURE BOUNDARIES (ports & adapters) ───────────────────────

    // Pure policy/logic must stay pure: zero IO. A `*-policy.ts` (and the other
    // pure rule modules) must NOT reach into adapters, the DB layer, routes/pages,
    // or IO-bearing node built-ins (fs/net/http/child_process/dns/pg). Keeping
    // these modules pure is what makes the ≥85% unit-coverage seam reachable.
    // NOTE: `node:crypto` is deliberately ALLOWED — HMAC/hashing is deterministic,
    // side-effect-free computation, not IO (used by webhook-trigger-policy +
    // user-invites-policy). We forbid the genuinely IO-bearing core modules only.
    {
      name: 'pure-lib-no-io',
      comment:
        'Pure logic (src/lib/*-policy.ts) must not import adapters, db, or app. ' +
        'Keeps the pure/unit-testable coverage seam clean. Baseline: 0 violations.',
      severity: 'error',
      from: { path: '^src/lib/[^/]*-policy\\.ts$' },
      to: {
        // adapters / db / app source imports:
        path: '^src/lib/adapters/|^src/db/|^src/app/',
      },
    },
    {
      name: 'pure-lib-no-io-core',
      comment:
        'Same seam, node built-ins arm: pure policy modules must not import ' +
        'IO-bearing core modules (fs/net/http/https/child_process/dns/dgram/tls). ' +
        'node:crypto is intentionally allowed (pure computation). Baseline: 0.',
      severity: 'error',
      from: { path: '^src/lib/[^/]*-policy\\.ts$' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|net|http|https|child_process|dns|dgram|tls|cluster|worker_threads)$',
      },
    },

    // Business logic must not depend on routes/pages. `src/lib/**` may never
    // import from `src/app/**` — dependencies point inward (app → lib), never out.
    {
      name: 'lib-no-app',
      comment:
        'Business logic (src/lib) must not import from routes/pages (src/app). ' +
        'Dependencies point inward. Baseline: 0 violations → ERROR.',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: '^src/app/' },
    },

    // A route handler must not import another route's module — routes are leaves,
    // shared logic belongs in src/lib. Prevents route→route coupling.
    {
      name: 'no-route-to-route',
      comment:
        'One route handler must not import another route module. Shared logic ' +
        'goes in src/lib, not sideways between routes. Baseline: 0 → ERROR.',
      severity: 'error',
      from: { path: '^src/app/api/.+/route\\.tsx?$' },
      to: { path: '^src/app/api/.+/route\\.tsx?$' },
    },

    // ── 3. RETIRED / BANNED MODULES ─────────────────────────────────────────
    // The clustered aggregator was killed — LiteLLM is the door now. Nothing in
    // application code (src/**) or live scripts may import the retired entrypoints.
    {
      name: 'no-retired-aggregator',
      comment:
        'The hand-rolled cluster gateway / aggregator is retired — LiteLLM is the ' +
        'gateway now. Nothing may IMPORT these modules (comments referencing them ' +
        'are fine; import edges are not). Baseline: 0 import edges → ERROR.',
      severity: 'error',
      from: {},
      to: {
        path: 'scripts/(cluster-gateway|gateway-aggregator)\\.mjs$',
      },
    },

    // ── 4. DEAD-CODE HYGIENE (aspirational → WARN) ──────────────────────────
    {
      name: 'no-orphans',
      comment:
        'Orphan modules (nothing imports them, and they are not an entry point) ' +
        'are usually dead code. WARN — we surface them without blocking; some are ' +
        'legit standalone scripts/config. See docs/GAPS_BACKLOG.md for the list.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$', // dot files (config)
          '\\.d\\.ts$', // type declarations
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack|next|postcss|tailwind|drizzle)\\.config\\.[cm]?[jt]s$',
          '^src/app/', // Next.js file-system routing entry points (pages/routes/layouts)
          '^scripts/', // standalone CLI scripts are entry points by nature
          '^src/middleware\\.ts$',
          '^src/instrumentation\\.ts$',
        ],
      },
      to: {},
    },

    // ── 5. STANDARD HYGIENE (from the init template) ────────────────────────
    {
      name: 'not-to-dev-dep',
      comment:
        'Production code must not depend on a devDependency (it will not be ' +
        'installed in prod). Scripts + tests are exempt.',
      severity: 'error',
      from: {
        path: '^src',
        pathNot: '\\.(spec|test)\\.[jt]sx?$',
      },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['node_modules/@types/'],
      },
    },
    {
      name: 'no-non-package-json',
      comment:
        'A dependency that is used but not declared in package.json will break ' +
        'a clean install. Declare every runtime dependency. Two known-good ' +
        'specifiers are excepted (pathNot): `server-only` (a virtual the Next.js ' +
        'compiler aliases to next/dist/compiled/server-only — real at build time, ' +
        'invisible to a static resolver), and `@offgrid/gateway/queue` (a valid ' +
        'subpath export of the @offgrid/gateway file: dep whose ./dist is only ' +
        'present after the shared monorepo is built — as it is in CI + on the ' +
        'server). Both resolve in a real build; neither is a missing dependency.',
      severity: 'error',
      from: {},
      to: {
        dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'],
        pathNot: ['^server-only$', '^@offgrid/'],
      },
    },
    {
      name: 'not-to-deprecated',
      comment: 'A module that depends on an npm module flagged deprecated by npm.',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
  ],

  options: {
    // Resolve the `@/*` → `./src/*` path alias (tsconfig.json) so import edges
    // through `@/lib/...` are seen the same as relative imports.
    tsConfig: { fileName: 'tsconfig.json' },
    // Follow pre-compilation (type-only) deps too — a type-only circular import
    // still breaks at build time under some transpile settings; we want it caught.
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    // Don't recurse into things we never want to analyze.
    exclude: {
      path: 'node_modules|\\.next/|coverage/|/dist/',
    },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      archi: {
        collapsePattern:
          '^(?:src/lib/adapters|src/lib|src/app/api|src/app|src/components|src/modules|scripts)',
      },
    },
  },
};
