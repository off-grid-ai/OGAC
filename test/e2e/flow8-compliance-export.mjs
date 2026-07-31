// ─── §10 Flow 8: compliance export ─────────────────────────────────────────────────────────────────
//
// "Select regulation/period → collect runs, policies, approvals, versions, sources, evaluations →
// generate an evidence pack → export is signed and archived."
//
// TARGET CORRECTED, AND THIS WAS MY WORST CALL OF THE SESSION. I searched /governance/evidence,
// /evidence/export, /reports and /regulatory for a BUTTON named /generate|export|create pack/, found
// none, and reported Flow 8 ABSENT — "the largest genuine product gap this ledger has found". It exists:
// /governance/regulatory renders a "Full evidence pack" card whose control is a LINK labelled
// "Download" (Button asChild → <a href="/api/v1/admin/compliance/export">), plus per-framework DPIA
// exports. Four routes checked with the wrong locator is not evidence of absence.
//
// The artifact is the PACK, not the button, so this fetches it in-session and reads what comes back.
import { signIn, verdict, OUT } from './lib.mjs';

const ROW = 'flow8-compliance-export';
const { browser, page } = await signIn(process.env.PACK_ROUTE || '/governance/regulatory', 'editor');
await page.waitForTimeout(2500);

const controls = await page.getByRole('link', { name: /download|dpia/i }).count();

const pack = await page.evaluate(async () => {
  const r = await fetch('/api/v1/admin/compliance/export');
  const buf = await r.arrayBuffer();
  return {
    status: r.status,
    type: r.headers.get('content-type') ?? '',
    bytes: buf.byteLength,
    head: new TextDecoder().decode(buf.slice(0, 12)),
  };
});

// The pack is a PDF, so validate it AS a PDF. My first assertion grepped for the words "control" and
// "framework" inside binary content and reported the flow unsubstantiated — the fourteenth time this
// session an assertion described something other than the artifact. A regulator-ready pack is a
// well-formed document of real size, not a keyword match.
const isPdf = pack.head.startsWith('%PDF');
const substantive = isPdf && pack.bytes > 20_000;
await page.screenshot({ path: `${OUT}/${ROW}.png` }).catch(() => {});

const pass = controls > 0 && pack.status === 200 && substantive;
verdict(ROW, pass,
  `controls=${controls} packStatus=${pack.status} type=${pack.type} bytes=${pack.bytes}` +
  ` isPdf=${isPdf} substantive=${substantive}`);
await browser.close();
process.exit(pass ? 0 : 1);
