// ─── Does a live artifact preview actually RENDER? ─────────────────────────────────────────────────
//
// The previous three attempts at this all "passed" while the founder's screen showed black rectangles:
// the CDN was blocked by our own CSP, then the vendored files 307'd to /signin. A screenshot alone was
// not enough either — a black box and a rendered dark diagram look similar at thumbnail size.
//
// So this asserts on the TERMINAL ARTIFACT inside the iframe:
//   • mermaid  → an <svg> exists in the preview frame (mermaid's output is SVG)
//   • react    → #root has at least one element child (the component mounted)
//   • html/svg → the body has non-trivial content
// and it prints every console error and failed request from the frame, because "black" is usually a
// blocked subresource, not a layout problem.
//
//   ssh -f -N -L 3000:127.0.0.1:3000 offgrid-tunnel   (or use the .local host on the office network)
//   DEMO_USER=demo-bank@getoffgridai.co DEMO_PASS=… ARTIFACTS=art_x,art_y \
//     OUT=/tmp/shots node scripts/verify-artifact-previews.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || '/tmp/shots';
const USER = process.env.DEMO_USER;
const PASS = process.env.DEMO_PASS;
// `ARTIFACTS=kind:id,kind:id` — the KIND is required, because the pass condition differs per kind and a
// generic "the body has some HTML" check is what let a CORS-blocked Mermaid frame report RENDERED on the
// first run of this script: the un-rendered <pre> source is itself 200+ characters of HTML.
const IDS = (process.env.ARTIFACTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [kind, id] = entry.includes(':') ? entry.split(':') : ['', entry];
    return { kind, id };
  });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

const failures = [];
page.on('console', (m) => {
  if (m.type() === 'error') failures.push(`console: ${m.text().slice(0, 160)}`);
});
page.on('requestfailed', (r) => failures.push(`request failed: ${r.url().slice(0, 120)}`));
page.on('response', (r) => {
  if (r.url().includes('/vendor/') && r.status() !== 200) {
    failures.push(`vendor ${r.status()}: ${r.url().replace(BASE, '')}`);
  }
});

await page.goto(`${BASE}/signin?callbackUrl=%2Fwork%2Fartifacts`, { waitUntil: 'networkidle' });
await page.fill('input[name=username]', USER);
await page.fill('input[name=password]', PASS);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForTimeout(4000);

// What counts as rendered, per kind. Deliberately narrow — each one is the output the renderer produces
// and nothing else could produce.
function passes(kind, probe) {
  // Mermaid injects its <svg> INSIDE the <pre class="mermaid"> rather than replacing it, so requiring
  // the <pre> to be gone failed a diagram that had rendered perfectly. The real signal is a diagram
  // <svg> that is NOT mermaid's error graphic.
  if (kind === 'mermaid') return probe.svgs > 0 && !/syntax error/i.test(probe.text);
  // A React error fallback is also one child of #root, so a count alone proves nothing — the fallback
  // text must be absent.
  if (kind === 'react') return probe.rootKids > 0 && !/no component to render|no default export/i.test(probe.text);
  if (kind === 'svg') return probe.svgs > 0;
  if (kind === 'html') return probe.bodyEls > 2;
  return probe.bodyEls > 0;
}

let allOk = true;
for (const { kind, id } of IDS) {
  failures.length = 0;
  await page.goto(`${BASE}/work/artifacts?artifact=${id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000); // mermaid/babel need a beat after load

  // THE PANEL's iframe, addressed through the panel element — not `frames().find(f => f !== main)`,
  // which returned the FIRST grid thumbnail and made all four artifacts report the same numbers (a
  // mermaid thumbnail's error graphic) regardless of which one was open.
  const panelFrame = await page
    .locator('aside iframe[title="artifact"]')
    .first()
    .elementHandle()
    .then((h) => h?.contentFrame() ?? null)
    .catch(() => null);
  const frame = panelFrame;
  if (!frame) {
    console.log(`${kind}/${id} NO PANEL FRAME (is the artifact id valid for this tenant?)`);
    allOk = false;
    await page.screenshot({ path: `${OUT}/artifact-${kind}-${id}-noframe.png` });
    continue;
  }
  const probe = await frame
    .evaluate(() => ({
      svgs: document.querySelectorAll('svg').length,
      // A .mermaid element still present means initialize() never ran or threw — mermaid swaps it out.
      mermaidPre: document.querySelectorAll('pre.mermaid').length,
      rootKids: document.getElementById('root')?.childElementCount ?? -1,
      bodyEls: document.body?.querySelectorAll('*').length ?? 0,
      text: (document.body?.innerText || '').trim().slice(0, 200),
    }))
    .catch((e) => ({ error: String(e).slice(0, 120), svgs: 0, mermaidPre: 1, rootKids: -1, bodyEls: 0 }));

  const ok = passes(kind, probe);
  if (!ok) allOk = false;
  console.log(
    `${kind}/${id} ${ok ? 'RENDERED' : 'NOT RENDERED'} — svgs=${probe.svgs} unrenderedMermaidPre=${probe.mermaidPre} rootChildren=${probe.rootKids} elements=${probe.bodyEls}${probe.error ? ` frameError=${probe.error}` : ''}`,
  );
  if (!ok && probe.text) console.log(`   frame shows: ${JSON.stringify(probe.text)}`);
  // Only the failures that matter: RSC prefetch aborts on nav are noise, a blocked vendor file is not.
  for (const f of new Set(failures)) {
    if (!f.includes('_rsc=')) console.log(`   ${f}`);
  }
  await page.screenshot({ path: `${OUT}/artifact-${kind}-${id}.png` });
}

await browser.close();
console.log(allOk ? '\nALL PREVIEWS RENDERED' : '\nAT LEAST ONE PREVIEW DID NOT RENDER');
process.exit(allOk ? 0 : 1);
