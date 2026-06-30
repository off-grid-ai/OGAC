// Builds the full Off Grid explainer slideshow: real logo + landing-page architecture
// diagrams (concept) woven with live console screenshots (reality) + plain captions.
// → explainer.html, which record-explainer.mjs films.
import { readFileSync, writeFileSync } from 'node:fs';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const DIAGRAMS = process.env.DIAGRAMS || '/Users/user/wednesday/off-grid-ai/console-landing-page/public/diagrams';
const LOGO_PATH = process.env.LOGO || '/Users/user/wednesday/off-grid-ai/mobile/src/assets/logo.png';
const SECONDS = Number(process.env.SECONDS || 5);

const dataUri = (p, mime) => `data:${mime};base64,${readFileSync(p).toString('base64')}`;
const LOGO = dataUri(LOGO_PATH, 'image/png');
const shot = (f) => dataUri(`${SHOTS}/${f}.png`, 'image/png');
const diag = (f) => dataUri(`${DIAGRAMS}/${f}.jpg`, 'image/jpeg');

// type: intro | pillars | diagram | shot | outro
const SLIDES = [
  { type: 'intro' },
  { type: 'pillars' },
  { type: 'diagram', img: diag('01-full-architecture'), tag: 'THE WHOLE PICTURE',
    h: 'One governed AI stack, on your own hardware',
    p: 'Off Grid is a private AI layer for your whole company — five planes that connect data, run models, govern every call, and prove what happened. No cloud, no lock-in.' },
  { type: 'diagram', img: diag('og-01-five-planes'), tag: 'THE FIVE PLANES',
    h: 'Five planes that work together',
    p: 'Data · AI · Control · Consumption · Org & Regulatory. Each is API-first and adoptable on its own — take the whole control plane, or just one part.' },
  { type: 'diagram', img: diag('og-02-request-lifecycle'), tag: 'REQUEST LIFECYCLE',
    h: 'Every AI call flows through one governed path',
    p: 'Policy is checked, guardrails run, the model answers on-device, egress is gated, and the whole thing is logged and signed. Nothing slips past.' },

  { type: 'diagram', img: diag('03-phase-a-data-plane'), tag: 'PLANE 1 · DATA',
    h: 'Connect, ingest, mask, govern',
    p: 'Pull in source systems, ingest documents, and scrub PII before anything reaches a model — AI-ready data that stays where it should.' },
  { type: 'shot', f: 'data', tag: 'DATA · IN THE CONSOLE',
    h: 'Connectors, ingestion & PII masking',
    p: 'Wire up sources, run ingest jobs, and define masking rules — the Data plane, made operable.' },

  { type: 'diagram', img: diag('04-phase-b-ai-plane'), tag: 'PLANE 2 · AI',
    h: 'Models, knowledge, tools, memory',
    p: 'The AI-ready substrate: open models served on-device, a knowledge base to ground them, tools they can call, and memory that persists.' },
  { type: 'shot', f: 'gateway', tag: 'GATEWAY · IN THE CONSOLE',
    h: 'One local, OpenAI-compatible engine',
    p: 'Text, vision, voice, embeddings — all on the device, behind one API. No cloud, no keys. This shows which capabilities are live.' },
  { type: 'shot', f: 'brain', tag: 'BRAIN · IN THE CONSOLE',
    h: 'Your private, grounded knowledge base',
    p: 'The documents agents cite from (RAG), with a verifier that checks every answer is actually backed by a real source.' },

  { type: 'diagram', img: diag('05-phase-c-control-plane'), tag: 'PLANE 3 · CONTROL',
    h: 'The gateway every call passes through',
    p: 'Policy, guardrails, audit, egress, kill switch — the layer that decides what AI is allowed to do across the whole org.' },
  { type: 'shot', f: 'control', tag: 'CONTROL · IN THE CONSOLE',
    h: 'Guardrails, egress & the kill switch',
    p: 'Choose models, decide what data may leave a device, run safety checks, and pull an instant org-wide kill switch — all logged.' },

  { type: 'diagram', img: diag('06-phase-d-consumption'), tag: 'PLANE 4 · CONSUMPTION',
    h: 'Where people meet the agents',
    p: 'Copilots and surfaces on every machine — and the feedback loop that makes them better. From copilots to autonomous workflows.' },
  { type: 'shot', f: 'agents', tag: 'AGENTS · IN THE CONSOLE',
    h: 'Pre-built assistants for real jobs',
    p: 'SOP writer, claims intake, sales coach — grounded in your data, bound by your policies. Anyone can author a new one in plain English.' },
  { type: 'shot', f: 'agent-detail', tag: 'AGENTS · DETAIL',
    h: 'Each agent, with its run history',
    p: 'What it does, the planes it touches, and every time it has run — all in one view.' },
  { type: 'shot', f: 'agent-trace', tag: 'AGENTS · GOVERNED TRACE',
    h: 'Every run is a signed, citable trace',
    p: 'The ordered steps, the guardrail checks (PII, grounding), the citations, and an ed25519 signature — proof of exactly what the agent did.' },

  { type: 'diagram', img: diag('07-phase-e-org-regulatory'), tag: 'PLANE 5 · ORG & REGULATORY',
    h: 'Defensible to a regulator and a board',
    p: 'Framework mapping, DPIA, and governance — the regulatory wrapper around everything, with provenance you can prove.' },
  { type: 'shot', f: 'regulatory', tag: 'REGULATORY · IN THE CONSOLE',
    h: 'Map AI usage to frameworks',
    p: 'The DPO’s home: governance items, framework coverage, and the evidence to back it up.' },

  // capabilities, console-led
  { type: 'shot', f: 'fleet', tag: 'FLEET CONTROL',
    h: 'MDM for AI — govern every device',
    p: 'Provision, observe, and kill-switch every AI-enabled machine from one screen. Push policy down, pull audit up.' },
  { type: 'shot', f: 'fleet-device', tag: 'FLEET · DEVICE',
    h: 'Drill into one device',
    p: 'Its policy, recent on-device activity (with egress + guardrail outcomes), and per-device controls.' },
  { type: 'shot', f: 'observability', tag: 'AGENT QA · OBSERVABILITY',
    h: 'Know the agents still work',
    p: 'Offline evals, live LLM-as-judge scoring, and drift detection — is each agent still doing a good job, and if not, which regressed and when?' },
  { type: 'shot', f: 'eval-detail', tag: 'AGENT QA · EVAL RUN',
    h: 'Drill into an eval run',
    p: 'Per-case pass/fail, the top source it grounded on, and the score — including the cases that (correctly) got blocked.' },
  { type: 'shot', f: 'lineage', tag: 'LINEAGE',
    h: 'Trace any answer to its source',
    p: 'Follow an answer back through the model, the data, and the exact document. Full provenance, end to end.' },
  { type: 'shot', f: 'reports', tag: 'REPORTS · PROVENANCE',
    h: 'Audit-ready, signed exports',
    p: 'Every export carries a signed, offline-verifiable manifest. Prove what was produced, by whom, unaltered — with only a public key.' },
  { type: 'shot', f: 'analytics', tag: 'ANALYTICS',
    h: 'Usage at a glance',
    p: 'How much AI is used, by whom, what it costs, how fast it responds, and whether quality is drifting.' },
  { type: 'shot', f: 'finops', tag: 'FINOPS',
    h: 'Predictable cost',
    p: 'Virtual API keys per person or team, each with a budget, plus per-user billing — AI spend never surprises you.' },
  { type: 'shot', f: 'integrations', tag: 'INTEGRATIONS',
    h: 'Plug into your stack',
    p: 'Connect Off Grid to the tools you already use, with response caching and live status.' },
  { type: 'shot', f: 'admin', tag: 'ADMIN',
    h: 'Who can do what',
    p: 'SSO, roles, and fine-grained access rules (ABAC) — with a tester to check a rule before it goes live.' },
  { type: 'outro' },
];

const N = SLIDES.filter((s) => s.type === 'diagram' || s.type === 'shot').length;

const css = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1600px;height:900px;overflow:hidden;background:#fff;font-family:Menlo,'SF Mono',ui-monospace,monospace;color:#0a0a0a}
.stage{width:1600px;height:900px;position:relative}
.slide{position:absolute;inset:0;opacity:0;transition:opacity .45s ease;display:flex;flex-direction:column;padding:48px 72px}
.slide.on{opacity:1}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.brand{display:flex;align-items:center;gap:11px;font-weight:700;font-size:19px}
.brand img{height:26px;width:26px;border-radius:6px}
.muted{color:#9ca3af;font-weight:400}
.count{font-size:13px;color:#9ca3af;letter-spacing:.08em}
.tag{font-size:13px;letter-spacing:.18em;color:#059669;font-weight:700;margin-bottom:6px}
.h{font-size:34px;font-weight:700;line-height:1.12;margin-bottom:9px;letter-spacing:-.01em}
.p{font-size:18px;line-height:1.45;color:#4b5563;max-width:1300px;margin-bottom:18px}
.frame{flex:1;border:1px solid #ececec;border-radius:14px;overflow:hidden;box-shadow:0 18px 50px -26px rgba(0,0,0,.26);background:#fafafa;display:flex;align-items:center;justify-content:center;min-height:0}
.frame.shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.frame.diagram{background:#fff;padding:18px}
.frame.diagram img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.bar{position:absolute;left:0;bottom:0;height:5px;background:#059669;width:0}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:16px;padding:0 120px}
.logoBig{height:96px;width:96px;border-radius:22px;margin-bottom:6px}
.big{font-size:58px;font-weight:700;letter-spacing:-.02em;line-height:1.06}
.sub{font-size:23px;color:#4b5563;max-width:1040px;line-height:1.45}
.kicker{font-size:14px;letter-spacing:.22em;color:#059669;font-weight:700}
.foot{font-size:13px;color:#9ca3af;letter-spacing:.08em;margin-top:6px}
.pill-wrap{display:grid;grid-template-columns:1fr 1fr;gap:18px;width:100%;max-width:1080px;margin-top:8px}
.pill{border:1px solid #ececec;border-radius:12px;padding:22px 24px;text-align:left;background:#fafafa}
.pill h4{font-size:20px;margin-bottom:7px}
.pill p{font-size:15px;color:#6b7280;line-height:1.4}
`;

const brand = `<div class="brand"><img src="${LOGO}"> Off Grid <span class="muted">CONSOLE</span></div>`;

function render(s, idx) {
  if (s.type === 'intro')
    return `<section class="slide"><div class="center">
      <img class="logoBig" src="${LOGO}">
      <div class="big">Your company's private AI,<br>controlled from one place.</div>
      <div class="sub">Off Grid runs open models on your own devices — no cloud, no accounts, no lock-in. This is the control plane that governs it: a quick tour.</div>
      <div class="foot">ON-PREM · LOCAL-FIRST · AUDITABLE</div></div></section>`;
  if (s.type === 'outro')
    return `<section class="slide"><div class="center">
      <img class="logoBig" src="${LOGO}">
      <div class="kicker">SEES · REMEMBERS · MOVES · ACTS</div>
      <div class="big">One private AI layer<br>for the whole company.</div>
      <div class="sub">Connect data, run models on-device, govern every call, and prove what happened — all on your own hardware.</div></div></section>`;
  if (s.type === 'pillars')
    return `<section class="slide"><div class="center">
      <div class="kicker">WHY OFF GRID</div>
      <div class="big" style="font-size:42px">Built for AI you can actually trust</div>
      <div class="pill-wrap">
        <div class="pill"><h4>On-prem &amp; local-first</h4><p>Runs on your own infrastructure. Models run on-device; data never leaves your control.</p></div>
        <div class="pill"><h4>Auditable by design</h4><p>Every model call, tool call, and byte of egress is logged — a record a regulator can defend.</p></div>
        <div class="pill"><h4>Modular</h4><p>Take the whole control plane or just one part. Every capability is API-first.</p></div>
        <div class="pill"><h4>Frontline-ready</h4><p>Govern thousands of edge devices from one console.</p></div>
      </div></div></section>`;
  // diagram or shot
  const counter = `<span class="count">${idx}/${N}</span>`;
  const media = s.type === 'diagram'
    ? `<div class="frame diagram"><img src="${s.img}"></div>`
    : `<div class="frame shot"><img src="${shot(s.f)}"></div>`;
  return `<section class="slide">
    <div class="top">${brand}${counter}</div>
    <div class="tag">${s.tag}</div><div class="h">${s.h}</div><div class="p">${s.p}</div>
    ${media}<div class="bar"></div></section>`;
}

let idx = 0;
const body = SLIDES.map((s) => {
  if (s.type === 'diagram' || s.type === 'shot') idx++;
  return render(s, idx);
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="stage">${body}</div>
<script>
const S=${SECONDS}*1000, slides=[...document.querySelectorAll('.slide')];
let i=0; window.__done=false;
function show(k){slides.forEach((s,j)=>s.classList.toggle('on',j===k));const b=slides[k].querySelector('.bar');if(b){b.style.transition='none';b.style.width='0';requestAnimationFrame(()=>{b.style.transition='width '+(S/1000)+'s linear';b.style.width='100%';});}}
show(0);
const t=setInterval(()=>{i++;if(i>=slides.length){window.__done=true;clearInterval(t);return;}show(i);},S);
</script></body></html>`;
writeFileSync(process.env.OUT || '/tmp/explainer.html', html);
console.log('built explainer:', SLIDES.length, 'slides (', N, 'feature slides ),', SECONDS, 's each ~', SLIDES.length * SECONDS, 's');
