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
// Usage:  node scripts/demo-readiness.mjs [--host suraksha|bharatunion] [--shots] [--links FILE]

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
const LINKS = args.includes('--links') ? args[args.indexOf('--links') + 1] : '/tmp/demo-links.json';
const rawPaths = JSON.parse(readFileSync(LINKS, 'utf8'));
// A featured run belongs to ONE tenant — the insurer's id genuinely does not exist on the bank, so
// checking the same id against both hosts reported a correct 404 as a defect. Swap in each tenant's
// own run, the way the one-pager does.
const FEATURED_RUN = { suraksha: 'agent%3Arun_0d632888', bharatunion: 'agent%3Arun_b922bd7b' };
const paths = rawPaths.map((p) =>
  p.startsWith('/operations/runs/agent%3A')
    ? `/operations/runs/${FEATURED_RUN[hostKey] ?? FEATURED_RUN.suraksha}`
    : p,
);

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

// Defects that make a screen unshowable even when it is full of content. Every one of these has
// reached a customer-facing surface in this product at least once, and each was found by a person
// looking at a screenshot rather than by any test.
const LEAKS = [
  // An OSS engine or our own codename, on a page a buyer reads. Found three times in three days.
  /io\.kestra|\bkestra\b/i, /\bpresidio\b/i, /\bopensearch\b/i, /\bqdrant\b/i, /\bllm[- ]?guard\b/i,
  /\blangfuse\b/i, /\bseaweedfs\b/i, /\bclickhouse\b/i, /\bopenbao\b/i, /\bmarquez\b/i,
  /\bunleash\b/i, /\blitellm\b/i, /\bairbyte\b/i, /\bevidently\b/i, /\bragas\b/i, /\bsuperset\b/i,
  // Internal identifiers. "blocked by proof:ceiling on org_suraksha" reached a buyer in an answer.
  /\borg_[a-z0-9_]+/, /\b[a-z]+\.[a-z]+\.(?:deny|allow|run|create|delete|write|read)\b/,
  // Rendering failures that read as broken software.
  /\*\*[A-Za-z]/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/,
  // A count that disagrees with its noun. Was on most of 193 cards in the action catalogue.
  /\b1 (?:actions|triggers|conditions|runs|apps|rows|tables|items|cases|records)\b/,
];
/**
 * Routes where a matched string is CORRECT, verified one at a time by reading the rendered page.
 *
 * Kept explicit rather than loosening the patterns, because the value of this harness is that a LEAK
 * line means something. Three earned their place:
 *
 *  • /data/integrations names Elasticsearch/OpenSearch in a connector-type description. That is a
 *    search engine the CUSTOMER runs and may register as a source — the same category as Postgres or
 *    MySQL, which we name freely. The rule is about not naming OURS.
 *  • /operations/services/capability-map is the service-inventory page an operator uses to administer
 *    the fleet. Its entire purpose is showing real service identities; hiding them would break it.
 *  • /work/prompts and /workspace/prompts matched "null" inside a PROMPT TEMPLATE that instructs a
 *    model to return valid JSON. That is user content, not a rendering bug.
 */
const ALLOWED_MATCHES = new Map([
  ['/data/integrations', /opensearch|elasticsearch/i],
  // Any engine: this page IS the service inventory. Listing one pattern per product would mean
  // re-editing the harness every time the fleet gains a component.
  ['/operations/services/capability-map', /./],
  ['/work/prompts', /\bnull\b/],
  ['/workspace/prompts', /\bnull\b/],
]);

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
  let records = 0;
  try {
    // RETRY. A full 169-route sweep takes long enough that this laptop hops WiFi mid-run, and the
    // first attempt reported ERR_NETWORK_CHANGED for ninety routes in a row — a wall of "failures"
    // that were entirely my own network. A verification run that cannot tell a dropped connection
    // from a broken page is worse than none, because the noise buries the real findings.
    let res = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        break;
      } catch (err) {
        const transient = /NETWORK_CHANGED|ERR_CONNECTION|ERR_NAME|Timeout|ERR_EMPTY_RESPONSE|socket hang up/i
          .test(String(err));
        if (!transient || attempt === 2) throw err;
        await page.waitForTimeout(4000 * (attempt + 1));
      }
    }
    status = res?.status() ?? 0;

    // WAIT FOR A REDIRECT TO SETTLE before reading. /data/lineage 308s to /data/lineage/graph, and
    // reading the page region mid-hop found it empty — so the harness reported "0 chars" on a page
    // that actually renders 1,861 characters of real lineage. A verification run that calls a working
    // page broken is worse than one that misses a fault: it sends someone to fix nothing.
    let settled = page.url();
    for (let i = 0; i < 8; i += 1) {
      await page.waitForTimeout(500);
      const now = page.url();
      if (now === settled) break;
      settled = now;
    }
    await page.waitForTimeout(2600);
    // Read the page region only — never the shell, nav or hellobar, whose text is identical everywhere
    // and would mask a genuinely bare page as thousands of characters of content.
    const read = await page.evaluate(() => {
      const main = document.querySelector('[data-og-shell="page"]') ?? document.querySelector('main');
      const scope = main ?? document.body;
      // SUBSTANCE, not length. A page can be full of headings, labels and empty-state prose and still
      // show a buyer nothing. Rows, cards and links to real records are what they came for.
      const records = scope.querySelectorAll(
        'tbody tr, li, a[href], button, [class*="card"], [class*="Card"], [role="row"], [role="listitem"]',
      ).length;
      return { text: (scope.innerText ?? '').replace(/\s+/g, ' ').trim(), records };
    });
    text = read.text;
    records = read.records;
  } catch (e) {
    rows.push({ path, status, verdict: 'ERROR', why: String(e.message).slice(0, 60), chars: 0, zeros: 0 });
    continue;
  }

  // A stat rail of nothing but zeros is the loudest "not ready" signal on this product, and it never
  // trips an empty-state string — the warehouse page showed four of them and prose claiming health.
  const numbers = [...text.matchAll(/\b(\d[\d,]*)\s*(?:B|KB|MB|GB)?\b/g)].map((m) => m[1].replace(/,/g, ''));
  const zeros = numbers.filter((n) => n === '0').length;
  const nonZero = numbers.filter((n) => n !== '0' && Number(n) > 0).length;

  const empty = EMPTY_PHRASES.find((re) => re.test(text));

  const broken2 = BROKEN_PHRASES.find((re) => re.test(text));
  const allowed = ALLOWED_MATCHES.get(path);
  const leak = LEAKS.filter((re) => !(allowed && re.source === allowed.source)).find((re) => {
    const m = text.match(re);
    return m && !(allowed && allowed.test(m[0]));
  });

  let verdict = 'OK';
  let why = '';
  if (status !== 200) { verdict = 'BROKEN'; why = `HTTP ${status}`; }
  else if (broken2) { verdict = 'BROKEN'; why = text.match(broken2)[0].slice(0, 50); }
  else if (leak) { verdict = 'LEAK'; why = text.match(leak)[0].slice(0, 50); }
  // An empty-state PHRASE only condemns a page that has little else. A rich page is allowed to say
  // "not configured" about one card among many — that is honesty, not emptiness, and treating it as a
  // failure taught me to distrust my own harness for two rounds.
  else if (empty && (records < 12 || text.length < 900)) {
    verdict = 'EMPTY';
    why = text.match(empty)[0].slice(0, 50);
  }
  else if (text.length < 260) { verdict = 'THIN'; why = `${text.length} chars`; }
  else if (nonZero === 0 && zeros > 0) { verdict = 'EMPTY'; why = `${zeros} figures, all zero`; }
  // Renders prose but points at nothing. Deliberately conservative: a page needs to be BOTH short and
  // unclickable to fail on this. An earlier version failed on records alone and flagged fourteen pages
  // that were fine, because plenty of surfaces here are built from divs my selector cannot see. A
  // false failure is worse than a miss — it sends people to fix what is not broken.
  else if (records === 0 && text.length < 700) { verdict = 'THIN'; why = `${text.length} chars, nothing to click`; }

  rows.push({ path, status, verdict, why, chars: text.length, records, zeros });
  if (SHOTS) {
    const name = path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
    await page.screenshot({ path: `${OUT}/${hostKey}-${name}.png` });
  }
}

await browser.close();

const order = { BROKEN: 0, LEAK: 1, EMPTY: 2, THIN: 3, ERROR: 4, OK: 5 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.path.localeCompare(b.path));
for (const r of rows) {
  console.log(`${r.verdict.padEnd(7)} ${r.path.padEnd(42)} ${r.why}`);
}
const bad = rows.filter((r) => r.verdict !== 'OK');
console.log(`\n${hostKey}: ${rows.length} links · ${bad.length} not demo-ready · ${rows.length - bad.length} fine`);
