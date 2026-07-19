#!/usr/bin/env node
// Capture every CANONICAL console route and emit a machine-readable visual release manifest.
// Historical redirect aliases remain deployed for bookmarks but are excluded from primary coverage
// through src/modules/route-migrations.mjs, the same IA contract used by Next.
//
// Safe production authentication (preferred):
//   OFFGRID_VISUAL_USER=demo-bank@getoffgridai.co \
//   OFFGRID_VISUAL_PASSWORD='…' \
//   node scripts/shoot-all.mjs --base=https://bharatunion-onprem-console.getoffgridai.co \
//     --states=off --public=off --folds=on --out=/tmp/vision-release-bank
//
// Permission-checked auth file (must be chmod 600):
//   OFFGRID_VISUAL_AUTH_FILE=/secure/visual-auth.json node scripts/shoot-all.mjs …
//   # JSON: {"user":"…","password":"…"}
//
// Legacy --user/--pass flags remain compatible, but expose the password in the process list.
// Output: <out>/*.png + <out>/manifest.json. Any real navigation, browser-console, page-runtime,
// screenshot, error-boundary, unresolved-dynamic-route, or document-overflow failure exits nonzero.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  batchItems,
  dynamicSegmentCoverage,
  isCanonicalRoute,
  pageDirectoryRecord,
  pageFailureReasons,
  resolveVisualAuth,
  selectCanonicalRouteRecords,
  visualGateExitCode,
} from './lib/visual-harness-policy.mjs';

function argValues(key) {
  return process.argv
    .filter((value) => value.startsWith(`--${key}=`))
    .map((value) => value.slice(key.length + 3));
}

function arg(key, fallback = '') {
  return argValues(key)[0] ?? fallback;
}

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const THEME = arg('theme', 'light');
const FOLDS = arg('folds', 'off') !== 'off';
const FOLD_CAP = Number(arg('fold-cap', '5'));
const VIEWPORT_RAW = arg('viewport', 'wide');
const STATES = arg('states', 'on') !== 'off';
const PUBLIC = arg('public', 'on') !== 'off';
const ROUTES_ROOT = arg('routes-root', 'src/app');
const BATCH_SIZE = Number(arg('batch-size', '30'));
const ONLY = argValues('only')
  .flatMap((value) => value.split(','))
  .map((value) => value.trim())
  .filter(Boolean);
const host = new URL(BASE).hostname.split('.')[0] || 'local';
const OUT = arg('out', `.shots/${host}-${THEME}-${VIEWPORT_RAW}`);

const VP =
  VIEWPORT_RAW === 'mobile'
    ? { width: 390, height: 844 }
    : VIEWPORT_RAW === 'wide'
      ? { width: 1440, height: 900 }
      : (() => {
          const [width, height] = VIEWPORT_RAW.split('x').map(Number);
          return { width: width || 1440, height: height || 900 };
        })();

function readAuthFile(path) {
  if (!path) return {};
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    throw new Error(`Visual auth file must not be group/world accessible (chmod 600 ${path}).`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return {
    user: String(parsed.user ?? parsed.username ?? parsed.email ?? ''),
    password: String(parsed.password ?? ''),
  };
}

function discoverRouteRecords(root) {
  const records = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'api') walk(path);
      } else if (entry.name === 'page.tsx') {
        records.push(pageDirectoryRecord(relative(root, directory)));
      }
    }
  }
  walk(root);
  return records;
}

const isDynamic = (route) => /\[[^\]]+\]/.test(route);
const slug = (route) =>
  (route === '/' ? 'root' : route.replace(/^\//, '').replace(/[/[\]]/g, '_')).replace(/_+/g, '_');
const isNoise = (text) => /cloudflareinsights\.com|beacon\.min\.js/i.test(text);

async function login(page, auth) {
  if (!auth.user) return;
  await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('input[type="password"]', { timeout: 20_000 });
  await page.fill('input[name="username"], input[type="email"], input[type="text"]', auth.user);
  await page.fill('input[type="password"]', auth.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.toString().includes('/signin'), { timeout: 30_000 });
  if (new URL(page.url()).pathname.startsWith('/signin')) {
    throw new Error('Visual harness authentication did not leave the sign-in page.');
  }
  await page.waitForTimeout(1_000);
}

async function createSession(browser, auth) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: VP,
    colorScheme: THEME === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: 2,
  });
  await context.addCookies([{ name: 'theme', value: THEME, url: BASE }]);
  await context.addInitScript((theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Public pages without storage access still receive colorScheme + the theme cookie.
    }
  }, THEME);
  const page = await context.newPage();
  await login(page, auth);
  return { context, page };
}

/*
 * Contextual level-3 destinations use [destination] pages. Expanding every rendered destination
 * link makes the live IA itself the source of exact coverage, while entity collections still use
 * one representative seeded id so a large tenant cannot make release verification unbounded.
 */
async function resolveConcreteRoutes(page, template) {
  const segments = template.split('/').filter(Boolean);
  let candidates = [[]];
  for (const segment of segments) {
    if (!/^\[.*\]$/.test(segment)) {
      candidates = candidates.map((candidate) => [...candidate, segment]);
      continue;
    }
    const nextCandidates = [];
    for (const concrete of candidates) {
      const prefix = `/${concrete.join('/')}`;
      let ids = [];
      try {
        await page.goto(BASE + prefix, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(700);
        const childPattern = new RegExp(`^${prefix.replace(/[/]/g, '\\/')}\\/([^/?#]+)`);
        const hrefs = await page.$$eval('a[href]', (anchors) =>
          anchors.map((anchor) => anchor.getAttribute('href')),
        );
        ids = [
          ...new Set(
            hrefs
              .map((href) => href?.match(childPattern)?.[1])
              .filter((id) => Boolean(id && !id.startsWith('['))),
          ),
        ];
      } catch {
        ids = [];
      }
      if (dynamicSegmentCoverage(segment) === 'first') {
        ids = ids.filter((id) => !['new', 'runs', 'reports'].includes(id)).slice(0, 1);
      }
      for (const id of ids) nextCandidates.push([...concrete, id]);
    }
    if (!nextCandidates.length) return [];
    candidates = nextCandidates;
  }
  return candidates
    .map((segmentsForRoute) => `/${segmentsForRoute.join('/')}`)
    .filter((route) => isCanonicalRoute(route));
}

async function inspectCurrentPage(page) {
  const bodyText = (await page.textContent('body').catch(() => '')) || '';
  const layoutOverflowPx = await page
    .evaluate(() => {
      const documentWidth = Math.max(
        document.documentElement?.scrollWidth ?? 0,
        document.body?.scrollWidth ?? 0,
      );
      return Math.max(0, Math.ceil(documentWidth - window.innerWidth));
    })
    .catch(() => 0);
  return { bodyText, layoutOverflowPx };
}

async function shoot(page, route, url, records, { authenticated, template = route }) {
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error' && !isNoise(message.text())) {
      consoleErrors.push(message.text().slice(0, 240));
    }
  };
  const onPageError = (error) => pageErrors.push(String(error.message || error).slice(0, 240));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let status = 0;
  let captureError = '';
  try {
    const response = await page.goto(BASE + url, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    status = response?.status() ?? 0;
    await page.waitForTimeout(1_200);
  } catch (error) {
    pageErrors.push(`navigation: ${String(error.message || error).slice(0, 180)}`);
  }

  const title = await page.title().catch(() => '');
  const file = `${slug(route)}.png`;
  try {
    await page.screenshot({ path: join(OUT, file), fullPage: true });
  } catch (error) {
    captureError = String(error.message || error).slice(0, 180);
  }

  if (FOLDS && !captureError) {
    try {
      const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const foldCount = Math.min(FOLD_CAP, Math.max(1, Math.ceil(totalHeight / VP.height)));
      for (let index = 0; index < foldCount; index += 1) {
        if (foldCount === 1) break;
        await page.evaluate((offset) => window.scrollTo(0, offset), index * VP.height);
        await page.waitForTimeout(250);
        const foldFile = `${slug(route)}__fold${index + 1}.png`;
        await page.screenshot({ path: join(OUT, foldFile), fullPage: false });
        records.push({
          route: `${route} [fold ${index + 1}/${foldCount}]`,
          template,
          url,
          file: foldFile,
          status,
          title,
          consoleErrors: [],
          pageErrors: [],
          layoutOverflowPx: 0,
          ok: true,
          notes: 'fold segment',
        });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch (error) {
      captureError = `fold capture: ${String(error.message || error).slice(0, 160)}`;
    }
  }

  const { bodyText, layoutOverflowPx } = await inspectCurrentPage(page);
  const redirectedToSignin =
    authenticated && route !== '/signin' && new URL(page.url()).pathname.startsWith('/signin');
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  const reasons = pageFailureReasons({
    status,
    bodyText,
    consoleErrors,
    pageErrors,
    captureError,
    layoutOverflowPx,
    redirectedToSignin,
  });
  records.push({
    route,
    template,
    url,
    file,
    status,
    title,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    pageErrors: [...new Set(pageErrors)].slice(0, 8),
    layoutOverflowPx,
    ok: reasons.length === 0,
    notes: reasons.join('; '),
  });
}

function shouldCaptureCreateState(route) {
  return /^(?:\/solutions\/(?:apps|tools|quality)|\/data\/(?:sources|domains|flows)|\/governance\/(?:access|teams|secrets|policies)|\/work\/prompts)(?:\/[^/]+)?$/.test(
    route,
  );
}

async function captureCreateState(page, route, records) {
  if (!STATES || !shouldCaptureCreateState(route)) return;
  const button = page
    .locator('button[type="button"]:not([aria-disabled="true"])')
    .filter({ hasText: /^(?:New|Create|Add|Register|Invite)\b/i })
    .first();
  if (!(await button.count())) return;

  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error' && !isNoise(message.text())) consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(String(error.message || error));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  let captureError = '';
  try {
    await button.click({ timeout: 3_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${slug(route)}__create.png`), fullPage: true });
  } catch (error) {
    captureError = String(error.message || error).slice(0, 180);
  }
  const { bodyText, layoutOverflowPx } = await inspectCurrentPage(page);
  const reasons = pageFailureReasons({
    status: 200,
    bodyText,
    consoleErrors,
    pageErrors,
    captureError,
    layoutOverflowPx,
  });
  records.push({
    route: `${route} [create dialog]`,
    url: route,
    file: `${slug(route)}__create.png`,
    status: 200,
    title: 'state:create',
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    pageErrors: [...new Set(pageErrors)].slice(0, 8),
    layoutOverflowPx,
    ok: reasons.length === 0,
    notes: reasons.length ? reasons.join('; ') : 'state-change capture',
  });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await page.keyboard.press('Escape').catch(() => {});
}

async function runBatch(browser, batch, records, auth, capturedRoutes) {
  const { context, page } = await createSession(browser, auth);
  try {
    for (const record of batch) {
      const route = record.route;
      if (isDynamic(route)) {
        const concreteRoutes = await resolveConcreteRoutes(page, route);
        if (!concreteRoutes.length) {
          records.push({
            route,
            template: route,
            url: null,
            file: null,
            status: 0,
            title: '',
            consoleErrors: [],
            pageErrors: [],
            layoutOverflowPx: 0,
            ok: false,
            notes: 'canonical dynamic route could not resolve a seeded entity',
          });
          process.stdout.write(`× ${route} (no canonical entity id)\n`);
          continue;
        }
        for (const concrete of concreteRoutes) {
          if (capturedRoutes.has(concrete)) continue;
          capturedRoutes.add(concrete);
          process.stdout.write(`· ${route} → ${concrete}\n`);
          await shoot(page, concrete, concrete, records, {
            authenticated: Boolean(auth.user),
            template: route,
          });
        }
      } else {
        if (capturedRoutes.has(route)) continue;
        capturedRoutes.add(route);
        process.stdout.write(`· ${route}\n`);
        await shoot(page, route, route, records, { authenticated: Boolean(auth.user) });
        await captureCreateState(page, route, records);
      }
    }
  } finally {
    await context.close();
  }
}

async function main() {
  if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) {
    throw new Error('--batch-size must be a positive integer.');
  }
  if (!Number.isInteger(FOLD_CAP) || FOLD_CAP < 1) {
    throw new Error('--fold-cap must be a positive integer.');
  }
  const authFile = arg('auth-file', process.env.OFFGRID_VISUAL_AUTH_FILE || '');
  const auth = resolveVisualAuth({
    cli: { user: arg('user'), password: arg('pass') },
    env: process.env,
    file: readAuthFile(authFile),
  });
  if (auth.error) throw new Error(auth.error);
  if (argValues('pass').length) {
    process.stderr.write(
      'warning: --pass is retained for compatibility but is visible in process arguments; prefer OFFGRID_VISUAL_PASSWORD or --auth-file.\n',
    );
  }
  if (!auth.user && !PUBLIC) {
    throw new Error(
      'Authenticated console crawl requested with --public=off, but no visual auth was supplied.',
    );
  }

  const discovered = discoverRouteRecords(ROUTES_ROOT);
  const eligible = auth.user
    ? discovered
    : discovered.filter((record) => record.surface === 'public');
  const selection = selectCanonicalRouteRecords(eligible, {
    includePublic: auth.user ? PUBLIC : true,
    only: ONLY,
  });
  if (!selection.routes.length) {
    throw new Error(
      auth.user
        ? 'No canonical routes matched this visual crawl.'
        : 'No public routes matched. Supply safe auth to crawl authenticated console routes.',
    );
  }

  mkdirSync(OUT, { recursive: true });
  const records = [];
  const capturedRoutes = new Set();
  const browser = await chromium.launch();
  try {
    for (const batch of batchItems(selection.routes, BATCH_SIZE)) {
      await runBatch(browser, batch, records, auth, capturedRoutes);
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    base: BASE,
    theme: THEME,
    viewport: VP,
    capturedAt: new Date().toISOString(),
    authentication: auth.user ? 'authenticated' : 'public-only',
    batchSize: BATCH_SIZE,
    routeInventory: {
      discovered: discovered.length,
      canonicalTemplatesSelected: selection.routes.length,
      canonicalConcreteRoutesCaptured: capturedRoutes.size,
      legacyAliasesExcluded: selection.aliases,
    },
    total: records.length,
    ok: records.filter((record) => record.ok).length,
    failed: records.filter((record) => !record.ok),
    shots: records,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const failures = manifest.failed;
  console.log(
    `\n${records.length} captured → ${OUT} · ok=${manifest.ok} · failed=${failures.length} · canonical-routes=${selection.routes.length} · legacy-aliases-excluded=${selection.aliases.length}`,
  );
  for (const failure of failures) {
    console.log(`  ⚠ ${failure.route} [${failure.status}] ${failure.notes}`);
  }
  process.exitCode = visualGateExitCode(records);
}

main().catch((error) => {
  process.stderr.write(`visual harness failed: ${String(error.message || error)}\n`);
  process.exitCode = 1;
});
