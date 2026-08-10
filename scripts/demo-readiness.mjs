// ─── Is every screen we point a buyer at actually demo-ready? ────────────────────────────────────
//
// The one-pager sends an investor or a CISO to forty specific screens. Three of them turned out to be
// empty — the warehouse with 0 tables, replication with no connections, orchestration with no jobs —
// and the reason was never a bug: the insurer tenant's data plane had simply never been seeded, while
// the bank's had.
//
// A page that renders is not the same as a page worth showing. So this walks every link as the real
// demo viewer and judges what a stranger would actually see: an empty state, a stat rail of zeros, a
// wall of "nothing here yet", or something with substance.
//
// Usage:  node scripts/demo-readiness.mjs [--host suraksha|bharatunion] [--shots]

import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const HOSTS = {
  suraksha: 'https://suraksha-onprem-console.getoffgridai.co',
  bharatunion: 'https://bharatunion-onprem-console.getoffgridai.co',
};
const args = process.argv.slice(2);
const hostKey = args.includes('--host') ? args[args.indexOf('--host') + 1] : 'suraksha';
const BASE = HOSTS[hostKey] ?? HOSTS.suraksha;
const SHOTS = args.includes('--shots');
const OUT = '/tmp/demo-shots';
const paths = JSON.parse(readFileSync('/tmp/demo-links.json', 'utf8'));

// Phrases the console uses when it has nothing to show. Sourced from the actual empty states rather
// than guessed, so a match is real evidence and not a coincidence.
const EMPTY_PHRASES = [
  /holds no tables yet/i,
  /no pipelines have been configured/i,
  /no connections are configured/i,
  /no etl jobs yet/i,
  /no plugins are installed/i,
  /nothing (?:here|to show|yet)/i,
  /\bno (?:records|rows|results|entries|items|data|runs|apps|agents|teams|sources|collections|jobs|events|reports|exports|leases|keys)\b[^.]{0,40}\byet\b/i,
  /hasn'?t been (?:configured|set up|created)/i,
  /isn'?t (?:configured|wired|enabled)/i,
  /not configured/i,
  /once (?:it'?s|its) connected/i,
  /create (?:one|your first)/i,
];
const BROKEN_PHRASES = [/page not found/i, /something went wrong/i, /application error/i, /unhandled/i];

if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// Sign in once. The demo links sign themselves in, so landing anywhere authenticates the session.
await page.goto(`${BASE}/signin?callbackUrl=%2Foverview`, { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForTimeout(20000);

// The guide panel covers a third of the screen and its own starter questions would pollute every
// body-text read. Dismiss it for the session.
await page.evaluate(() => window.sessionStorage.setItem('offgrid.guide.dismissed', '1'));

const rows = [];
for (const path of paths) {
  const url = `${BASE}${path}`;
  let status = 0;
  let text = '';
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    status = res?.status() ?? 0;
    await page.waitForTimeout(2600);
    // Read the page region only — never the shell, nav or hellobar, whose text is identical everywhere
    // and would mask a genuinely bare page.
    text = await page.evaluate(() => {
      const main = document.querySelector('[data-og-shell="page"]') ?? document.querySelector('main');
      return (main?.innerText ?? document.body.innerText).replace(/\s+/g, ' ').trim();
    });
  } catch (e) {
    rows.push({ path, status, verdict: 'ERROR', why: String(e.message).slice(0, 60), chars: 0, zeros: 0 });
    continue;
  }

  // A stat rail of nothing but zeros is the loudest "not ready" signal on this product, and it never
  // trips an empty-state string — the warehouse page showed four of them and prose claiming health.
  const numbers = [...text.matchAll(/\b(\d[\d,]*)\s*(?:B|KB|MB|GB)?\b/g)].map((m) => m[1].replace(/,/g, ''));
  const zeros = numbers.filter((n) => n === '0').length;
  const nonZero = numbers.filter((n) => n !== '0' && Number(n) > 0).length;

  const broken = BROKEN_PHRASES.find((re) => re.test(text));
  const empty = EMPTY_PHRASES.find((re) => re.test(text));

  let verdict = 'OK';
  let why = '';
  if (status !== 200) { verdict = 'BROKEN'; why = `HTTP ${status}`; }
  else if (broken) { verdict = 'BROKEN'; why = text.match(broken)[0].slice(0, 50); }
  else if (empty) { verdict = 'EMPTY'; why = text.match(empty)[0].slice(0, 50); }
  else if (text.length < 260) { verdict = 'THIN'; why = `${text.length} chars of content`; }
  else if (nonZero === 0 && zeros > 0) { verdict = 'EMPTY'; why = `${zeros} figures, all zero`; }

  rows.push({ path, status, verdict, why, chars: text.length, zeros });
  if (SHOTS) {
    const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
    await page.screenshot({ path: `${OUT}/${hostKey}-${name}.png` });
  }
}

await browser.close();

const order = { BROKEN: 0, EMPTY: 1, THIN: 2, ERROR: 3, OK: 4 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.path.localeCompare(b.path));
for (const r of rows) {
  console.log(`${r.verdict.padEnd(7)} ${r.path.padEnd(42)} ${r.why}`);
}
const bad = rows.filter((r) => r.verdict !== 'OK');
console.log(`\n${hostKey}: ${rows.length} links · ${bad.length} not demo-ready · ${rows.length - bad.length} fine`);
