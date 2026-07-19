# Visual release verification

`scripts/shoot-all.mjs` is the Console's canonical screenshot and browser-health release gate. Run it
after the production build and again against the deployed tenant. It uses the real browser, real
routes, real authentication, and real seeded data; it does not mock Console behavior.

## What it covers

- Discovers `page.tsx` route templates from `src/app`.
- Preserves route-group ownership, so `--public=off` means authenticated Console routes only.
- Applies `src/modules/route-migrations.mjs` and excludes historical redirect aliases from primary
  coverage. Legacy URLs remain supported, but do not duplicate the visual audit.
- Expands every rendered `[destination]` link for contextual level-three navigation. This covers the
  current Solutions, Data, AI Runtime, Governance, Insights, and Operations IA rather than one
  arbitrary destination per dynamic page.
- Resolves one representative seeded entity for ordinary `[id]`, `[runId]`, and similar detail
  routes, keeping the crawl bounded for large tenants.
- Recycles the authenticated Playwright context every 30 route templates by default.
- Captures full-page PNGs, with optional readable viewport folds for tall screens.
- Optionally opens known non-submit create controls and captures their dialog state.

The command exits nonzero when a canonical route cannot resolve, navigation fails, an authenticated
route returns to sign-in, the browser reports a console/runtime error, an application error boundary
renders, screenshot capture fails, or the document overflows the viewport horizontally. Business
copy containing values such as `500`, `5000`, or `500 ms` is not treated as an error.

## One-time browser setup

The npm package and browser binary are separate. After installing dependencies, install the pinned
Chromium runtime:

```bash
npx playwright install chromium
```

## Safe authentication

Prefer dedicated environment variables. They are not written into the manifest or command line:

```bash
export OFFGRID_VISUAL_USER='viewer@example.com'
read -r -s OFFGRID_VISUAL_PASSWORD
export OFFGRID_VISUAL_PASSWORD
```

Alternatively, create a permission-restricted JSON file:

```bash
AUTH_FILE="$(mktemp)"
chmod 600 "$AUTH_FILE"
# Write this JSON with your password manager, not a committed file:
# {"user":"viewer@example.com","password":"..."}
export OFFGRID_VISUAL_AUTH_FILE="$AUTH_FILE"
```

`--user` and `--pass` still work for old automation, but `--pass` is visible in the process list and
prints a warning. Do not use it for production credentials.

## Release commands

Wide, light, authenticated Console audit with readable folds:

```bash
node scripts/shoot-all.mjs \
  --base=https://TENANT-onprem-console.getoffgridai.co \
  --theme=light \
  --viewport=wide \
  --states=off \
  --public=off \
  --folds=on \
  --batch-size=30 \
  --out=/tmp/offgrid-vision-TENANT-wide
```

Repeat at mobile width for shell and overflow confidence:

```bash
node scripts/shoot-all.mjs \
  --base=https://TENANT-onprem-console.getoffgridai.co \
  --theme=light \
  --viewport=mobile \
  --states=off \
  --public=off \
  --out=/tmp/offgrid-vision-TENANT-mobile
```

During development, point `--base` at the local server. An authenticated local full crawl requires
the local Keycloak/password seam. For the isolated Solutions create/edit/back/mobile journey, use:

```bash
npm run verify:solutions-ui
```

Useful scoping flags:

```bash
# One or more --only flags are accepted; comma-separated fragments also work.
node scripts/shoot-all.mjs --only=solutions --only=governance,operations [other flags]
```

## Evidence and verdict

Every output directory contains PNGs and `manifest.json`. The manifest records:

- discovered templates and excluded legacy aliases;
- exact canonical routes captured from dynamic destinations;
- HTTP status, title, console errors, uncaught page errors, overflow pixels, and failure reasons;
- a top-level failed list suitable for CI or release tooling.

A zero exit means the mechanical browser/layout gate passed. It is not a pixel-baseline comparison
and not, by itself, a visual-design approval. A reviewer must still inspect the actual pixels for
hierarchy, clipping, density, loading/empty/error composition, correct tenant data, and brand fit.
Historical review evidence and the semantic rubric live in `docs/E2E_VISION_AUDIT.md`.
