// ─── Automated sweep for the DEFECT CLASSES found by reading screenshots ────────────────────────────
//
// Reading 48 images one at a time found real defects, but the same class kept recurring on pages I had
// not looked at yet — overlapping card headers appeared on /data/catalog and again five times on
// /insights/ai. An image review cannot scale to every route and every state; a measurement can.
//
// Each check below encodes one class that was found BY EYE first, so it detects the real thing rather
// than a proxy:
//   overlap   — two text-bearing siblings whose boxes intersect (the card-header grid bug)
//   clipped   — text wider than its own container, i.e. content cut off at an edge
//   vendor    — an OSS/internal name in visible text (ragas, qdrant, brain, langfuse…)
//   escapes   — a literal \n or \t rendered as characters
//
// Usage: WHO=<email> ROUTES=a,b,c node scripts/ui-defect-sweep.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const WHO = process.env.WHO || 'demo-bank@getoffgridai.co';
const PASS = process.env.PASS || 'OffGridDemo2026!';
const TAG = process.env.TAG || WHO.split('@')[0];
const ROUTES = (process.env.ROUTES || '/overview').split(',').map((r) => r.trim()).filter(Boolean);

// Names that must never appear in customer-visible text. Kept in step with src/lib/lineage-labels.ts.
// Names that must never appear in customer-visible text. Kept in step with src/lib/lineage-labels.ts.
//
// DELIBERATELY EXCLUDES the storage engines a data catalogue legitimately names — "Warehouse (ClickHouse)",
// "Core Insurance (Postgres)" — because an operator has to know where a dataset actually lives, and those
// are standard infrastructure rather than our mechanism. What must stay hidden is our AI-engine choices
// (which evaluator scored an answer, which vector store retrieved it) and any component named inside an
// error the user cannot act on.
const VENDOR = /\b(ragas|qdrant|langfuse|evidently|llm[- ]?guard|kestra|openbao)\b/i;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'networkidle', timeout: 30000 });
await page.fill('input[name=username]', WHO);
await page.fill('input[name=password]', PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForTimeout(4500);

let findings = 0;
for (const route of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const result = await page.evaluate((vendorSrc) => {
    const vendor = new RegExp(vendorSrc, 'i');
    const out = { overlap: [], clipped: [], vendor: [], escapes: [] };
    const text = (el) => (el.textContent || '').trim();

    for (const h of document.querySelectorAll('[data-slot=card-header], .og-card__header')) {
      const kids = [...h.children].filter((c) => text(c).length > 2)
        .map((c) => ({ t: text(c).slice(0, 26), r: c.getBoundingClientRect() }));
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].r, b = kids[j].r;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 6 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 6) {
            out.overlap.push(`${kids[i].t} / ${kids[j].t}`);
          }
        }
      }
    }

    // Clipped: a leaf element whose content is wider than itself AND not deliberately scrollable.
    for (const el of document.querySelectorAll('main *')) {
      if (el.children.length > 0) continue;
      const t = text(el);
      if (t.length < 4) continue;
      const style = getComputedStyle(el);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
      if (style.textOverflow === 'ellipsis') continue; // truncation is a choice, not a bug
      // sr-only text is DELIBERATELY a 1px clipped box for screen readers, so it trips a naive
      // "content wider than its container" test. Reporting accessibility markup as a layout defect sent me
      // looking at Pagination four times for nothing.
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) continue;
      if (style.position === 'absolute' && style.clip !== 'auto') continue;
      if (el.scrollWidth - el.clientWidth > 4) out.clipped.push(t.slice(0, 40));
    }

    const body = (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ');
    const v = body.match(vendor);
    if (v) out.vendor.push(v[0]);
    if (/\\n|\\t/.test(body)) out.escapes.push('literal escape');
    return out;
  }, VENDOR.source);

  for (const [kind, hits] of Object.entries(result)) {
    if (hits.length) {
      findings += hits.length;
      console.log(`${TAG} ${route.padEnd(26)} ${kind.toUpperCase()} x${hits.length}: ${hits[0]}`);
    }
  }
}
console.log(`${TAG} findings: ${findings} across ${ROUTES.length} routes`);
await browser.close();
process.exit(findings ? 1 : 0);
