import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GUIDE_QUESTIONS,
  GUIDE_THEMES,
  guideQuestionsForTenant,
  isReadOnlySafeHref,
  resolveGuideDestinations,
} from '../src/lib/guide-copilot.ts';
import { leaksInternalName, publicLabel } from '../src/lib/lineage-labels.ts';

// ─── The load-bearing test: every destination is a route that EXISTS ─────────────────────────────
//
// A dead "Take me there" is worse than no guide at all — it is the one failure a stranger reads as
// "this product is broken", and it cannot be caught by typecheck or by a build. So rather than trust
// the table, this walks the REAL Next.js app router on disk and resolves each href the way Next does:
// route groups `(console)` are transparent, `[param]` matches one segment, `[...rest]` matches the
// rest. `/build` genuinely 404s (a route-group folder with no page.tsx) and this is what would catch
// anyone linking it.

const APP_DIR = path.join(fileURLToPath(new URL('../src/app', import.meta.url)));

interface RouteNode {
  children: Map<string, RouteNode>;
  /** A `[param]` child, if the directory has one. */
  param?: RouteNode;
  /** True when a `[...catchAll]` child exists — everything below it resolves. */
  catchAll: boolean;
  /** True when this directory has a page.tsx, i.e. the path itself is renderable. */
  page: boolean;
}

function emptyNode(): RouteNode {
  return { children: new Map(), catchAll: false, page: false };
}

/** Build the router tree from disk. Route groups `(x)` and private folders `_x` are transparent. */
function buildTree(dir: string, node: RouteNode): RouteNode {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name === 'page.tsx' || entry.name === 'page.ts') node.page = true;
      continue;
    }
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const full = path.join(dir, name);
    if (name.startsWith('@') || name.startsWith('_') || name === 'api') continue;
    if (name.startsWith('(') && name.endsWith(')')) {
      // Route group: its children live at the SAME path level.
      buildTree(full, node);
      continue;
    }
    if (name.startsWith('[...') || name.startsWith('[[...')) {
      node.catchAll = true;
      continue;
    }
    if (name.startsWith('[') && name.endsWith(']')) {
      node.param = buildTree(full, node.param ?? emptyNode());
      continue;
    }
    node.children.set(name, buildTree(full, node.children.get(name) ?? emptyNode()));
  }
  return node;
}

const ROUTER = buildTree(APP_DIR, emptyNode());

/** Does this pathname resolve to a page in the real app router? */
function routeExists(href: string): boolean {
  const pathname = href.split(/[?#]/)[0];
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let node: RouteNode | undefined = ROUTER;
  for (const segment of segments) {
    if (!node) return false;
    if (node.catchAll) return true;
    const literal = node.children.get(segment);
    node = literal ?? node.param;
    if (!node) return false;
  }
  return node?.page === true;
}

// The walker has to be trustworthy before its verdicts mean anything.
test('the router walker agrees with the routes we know the shape of', () => {
  assert.equal(routeExists('/overview'), true, 'a plain page');
  assert.equal(routeExists('/work/tasks'), true, 'a nested page inside a route group');
  assert.equal(routeExists('/operations/runs/agent%3Arun_x'), true, 'a [id] param segment');
  assert.equal(routeExists('/insights/cost/overview?window=7d'), true, 'a query string is ignored');
  assert.equal(routeExists('/docs/anything/at/all'), true, 'a [...slug] catch-all');
  assert.equal(routeExists('/build'), false, 'a route group folder with no page.tsx — the known 404');
  assert.equal(routeExists('/there/is/no/such/screen'), false, 'a route that does not exist');
});

test('EVERY destination in the guide table is a route that exists', () => {
  for (const question of GUIDE_QUESTIONS) {
    for (const destination of question.destinations) {
      assert.equal(
        routeExists(destination.href),
        true,
        `${question.id} → ${destination.href} is not a real route`,
      );
    }
  }
});

test('no destination is a write surface a read-only visitor would be refused on', () => {
  for (const question of GUIDE_QUESTIONS) {
    for (const destination of question.destinations) {
      assert.equal(
        isReadOnlySafeHref(destination.href),
        true,
        `${question.id} → ${destination.href} looks like a write flow`,
      );
    }
  }
});

test('isReadOnlySafeHref rejects write flows and keeps ordinary reads', () => {
  assert.equal(isReadOnlySafeHref('/solutions/apps/new'), false);
  assert.equal(isReadOnlySafeHref('/solutions/apps/forge'), false);
  assert.equal(isReadOnlySafeHref('/governance/access/invite'), false);
  assert.equal(isReadOnlySafeHref('/data/sources/add'), false);
  assert.equal(isReadOnlySafeHref('/work/tasks'), true);
  assert.equal(isReadOnlySafeHref('/operations/runs?status=succeeded'), true);
  // A segment that merely CONTAINS a write word is not a write flow.
  assert.equal(isReadOnlySafeHref('/data/newsroom'), true);
  assert.equal(isReadOnlySafeHref('/insights/addendum'), true);
});

// ─── Nothing a visitor reads may name an OSS component ──────────────────────────────────────────

test('no label or description shown to a visitor names an internal component', () => {
  for (const theme of GUIDE_THEMES) {
    assert.equal(leaksInternalName(theme.label), false, theme.label);
  }
  for (const question of GUIDE_QUESTIONS) {
    assert.equal(leaksInternalName(question.question), false, question.question);
    for (const d of question.destinations) {
      assert.equal(leaksInternalName(d.label), false, d.label);
      assert.equal(leaksInternalName(d.what), false, d.what);
    }
  }
});

test('the jargon mapper actually covers the engines the route index names', () => {
  // These five were missing, so `leaksInternalName` returned false for "Policy rules (ABAC / OPA)"
  // and the guard below would have passed while the leak shipped. Assert the mapping, not just the
  // absence of a detection.
  assert.equal(publicLabel('Policy rules (ABAC / OPA)'), 'Policy rules (ABAC / policy engine)');
  for (const raw of ['opa', 'rego', 'presidio', 'litellm', 'marquez', 'superset']) {
    assert.notEqual(publicLabel(raw), raw, `${raw} is still shown verbatim`);
    assert.equal(leaksInternalName(publicLabel(raw)), false, raw);
  }
  // Word boundaries: an ordinary word that merely contains one of them is untouched.
  for (const ok of ['opal', 'copay', 'Europa', 'oregano']) assert.equal(publicLabel(ok), ok);
});

test('a label borrowed from the shared route index is sanitised before a visitor reads it', () => {
  // The ⌘K index is written for operators and one of its titles names the policy engine. Falling back
  // to that index must not undo the jargon rule, so the caller passes publicLabel in.
  const { destinations, match } = resolveGuideDestinations('rego', {
    tenantSlug: 'suraksha',
    sanitize: publicLabel,
  });
  assert.equal(match, 'index');
  assert.ok(destinations.length > 0);
  for (const d of destinations) {
    assert.equal(leaksInternalName(d.label), false, d.label);
    assert.equal(leaksInternalName(d.what), false, d.what);
  }
});

// ─── The mapping itself: a question lands on the screen that answers it ─────────────────────────

test('a clicked starter question resolves to its own curated destinations', () => {
  for (const question of GUIDE_QUESTIONS) {
    const { destinations, match } = resolveGuideDestinations(question.question, {
      tenantSlug: 'suraksha',
    });
    assert.equal(match, 'starter', question.id);
    assert.ok(destinations.length > 0, question.id);
  }
});

test('a question asked in the visitor’s own words lands on the right screen', () => {
  const cases: [string, string][] = [
    ['Does any of our data leave the network?', '/governance/egress'],
    ['what happens if someone pastes a PAN into a prompt', '/governance/guardrails'],
    ['can I see the audit trail for a regulator', '/governance/evidence/audit'],
    ['what is waiting for a person to approve', '/work/tasks'],
    ['how much does all this spend cost us', '/insights/cost/overview'],
    ['what is the ROI, what have we saved', '/insights/outcomes'],
    ['does the AI hallucinate, is it grounded', '/operations/runs/agent%3Arun_0345c0ac'],
    ['is this a real live system or a mockup', '/operations/runs'],
    ['where did the facts come from, show me lineage', '/data/lineage'],
    ['what apps can my department automate', '/solutions/apps'],
  ];
  for (const [asked, expected] of cases) {
    const { destinations, match } = resolveGuideDestinations(asked, { tenantSlug: 'suraksha' });
    assert.ok(match === 'topic' || match === 'starter', `${asked} → ${match}`);
    assert.equal(destinations[0].href, expected, `${asked} → ${destinations[0]?.href}`);
  }
});

test('an unrelated question degrades honestly instead of guessing a page', () => {
  for (const nonsense of [
    'what is the weather in Pune tomorrow',
    'zzzz',
    'my cat sat on the keyboard qwerty',
  ]) {
    const { destinations, match } = resolveGuideDestinations(nonsense, { tenantSlug: 'suraksha' });
    assert.equal(match, 'none', `${nonsense} → ${match}`);
    assert.deepEqual(destinations, []);
  }
});

test('a question too short to mean anything resolves to nothing', () => {
  for (const q of ['', ' ', 'ok']) {
    assert.deepEqual(resolveGuideDestinations(q).destinations, []);
    assert.equal(resolveGuideDestinations(q).match, 'none');
  }
});

test('a single incidental word is not enough to send someone somewhere', () => {
  // "run" alone appears in half the product. One weak hit must not beat an honest "I do not know".
  assert.equal(resolveGuideDestinations('run', { tenantSlug: 'suraksha' }).match, 'none');
});

// ─── Tenant scoping — a hardcoded entity id must never be offered to the wrong tenant ───────────
//
// LIVE FINDING (2026-08-05): requesting the insurer's run_0d632888 as the BANK demo viewer returns
// HTTP 200 with an EMPTY body. The org scoping is correct, but an unscoped table would have shipped a
// blank screen as a destination.

test('an entity-anchored destination is only offered to the tenant that has it', () => {
  const insurer = resolveGuideDestinations('show me the AI doing real work end to end', {
    tenantSlug: 'suraksha',
  }).destinations.map((d) => d.href);
  const bank = resolveGuideDestinations('show me the AI doing real work end to end', {
    tenantSlug: 'bharatunion',
  }).destinations.map((d) => d.href);

  assert.ok(insurer.includes('/operations/runs/agent%3Arun_0d632888'));
  assert.ok(!insurer.includes('/operations/runs/agent%3Arun_b922bd7b'));
  assert.ok(bank.includes('/operations/runs/agent%3Arun_b922bd7b'));
  assert.ok(!bank.includes('/operations/runs/agent%3Arun_0d632888'));
});

test('an unknown tenant is offered only the tenant-neutral routes', () => {
  const { destinations } = resolveGuideDestinations('show me the AI doing real work end to end', {
    tenantSlug: 'some-new-customer',
  });
  assert.deepEqual(
    destinations.map((d) => d.href),
    ['/operations/runs'],
  );
  for (const d of destinations) assert.equal(d.tenants, undefined);
});

test('no tenant slug at all still yields a usable guide', () => {
  const questions = guideQuestionsForTenant(null);
  assert.equal(questions.length, GUIDE_QUESTIONS.length, 'no question is left with nowhere to go');
  for (const q of questions) {
    assert.ok(q.destinations.length > 0, q.id);
    for (const d of q.destinations) assert.equal(d.tenants, undefined);
  }
});

test('both live demo tenants get every question, with their own entity anchored in', () => {
  for (const slug of ['suraksha', 'bharatunion']) {
    const questions = guideQuestionsForTenant(slug);
    assert.equal(questions.length, GUIDE_QUESTIONS.length, slug);
    for (const q of questions) assert.ok(q.destinations.length > 0, `${slug}/${q.id}`);
  }
  const bank = guideQuestionsForTenant('bharatunion').find((q) => q.id === 'what-apps-do');
  assert.ok(bank?.destinations.some((d) => d.href === '/solutions/apps/bhapp_reimb/review'));
  const insurer = guideQuestionsForTenant('suraksha').find((q) => q.id === 'what-apps-do');
  assert.ok(!insurer?.destinations.some((d) => d.href.includes('bhapp_reimb')));
});

// ─── Table hygiene ─────────────────────────────────────────────────────────────────────────────

test('every question belongs to a real theme and every theme has questions', () => {
  const themeIds = new Set(GUIDE_THEMES.map((t) => t.id));
  for (const q of GUIDE_QUESTIONS) assert.ok(themeIds.has(q.theme), q.id);
  for (const t of GUIDE_THEMES) {
    assert.ok(
      GUIDE_QUESTIONS.some((q) => q.theme === t.id),
      `theme ${t.id} has no questions`,
    );
  }
});

test('question ids are unique and every question has at least one destination', () => {
  const ids = GUIDE_QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of GUIDE_QUESTIONS) {
    assert.ok(q.destinations.length > 0, q.id);
    assert.ok(q.keywords.length > 0, q.id);
  }
});

test('starter questions are written to the reader, as questions', () => {
  for (const q of GUIDE_QUESTIONS) {
    assert.ok(q.question.endsWith('?') || q.question.endsWith('.'), q.question);
    assert.ok(q.question.length > 20, `${q.id} is too terse to read as a question`);
  }
});

test('duplicate destinations within one answer are collapsed', () => {
  // "What is waiting for a person" points at /work/tasks twice in the table (the queue, and the
  // cover panel on the same screen); a visitor must see one button, not the same route twice.
  const { destinations } = resolveGuideDestinations('What is waiting for a person to decide right now?');
  const hrefs = destinations.map((d) => d.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});
