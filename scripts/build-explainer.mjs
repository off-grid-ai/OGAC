// Builds a self-contained flat-white explainer slideshow (screenshots + plain-language
// captions, auto-advancing) → explainer.html. Then record-explainer.mjs films it.
import { readFileSync, writeFileSync } from 'node:fs';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const SECONDS = Number(process.env.SECONDS || 5);
const b64 = (f) => `data:image/png;base64,${readFileSync(`${SHOTS}/${f}.png`).toString('base64')}`;

// intro + one entry per feature: file, module label, headline, plain explanation for a designer.
const SLIDES = [
  { intro: true },
  { f: 'fleet', tag: 'FLEET', h: 'Every AI device, one screen',
    p: 'Like an MDM, but for AI. See which machines are running Off Grid, who is online, what policy each is on — and kill or re-provision any device instantly.' },
  { f: 'fleet-device', tag: 'FLEET · DEVICE', h: 'Drill into one device',
    p: 'Its current policy, recent activity, and per-device controls — the kill switch and re-provision live here.' },
  { f: 'gateway', tag: 'GATEWAY', h: 'The local AI engine',
    p: 'One OpenAI-compatible endpoint running open models on the device itself — text, vision, voice, embeddings. No cloud, no API keys. This shows which capabilities are live.' },
  { f: 'control', tag: 'CONTROL', h: 'The guardrails',
    p: 'Decide what the AI is allowed to do: which models, what data may leave a device, safety checks — plus an instant org-wide kill switch. Every action is logged.' },
  { f: 'data', tag: 'DATA', h: 'Your data, masked first',
    p: 'Connect sources and ingest documents — with PII masking so sensitive fields are scrubbed before anything ever reaches a model.' },
  { f: 'brain', tag: 'BRAIN', h: 'The private knowledge base',
    p: 'The documents your AI can ground its answers in (RAG), with a verifier that checks every answer is actually backed by a real source.' },
  { f: 'agents', tag: 'AGENTS', h: 'Pre-built assistants for real jobs',
    p: 'Ready-made agents (SOP writer, claims intake, sales coach) grounded in your data and bound by your policies. Anyone can author a new one in plain English.' },
  { f: 'observability', tag: 'OBSERVABILITY', h: 'Quality control for the AI',
    p: 'Eval scores, test cases, and traces of exactly what the AI did — so you can trust it before it ships.' },
  { f: 'analytics', tag: 'ANALYTICS', h: 'Usage at a glance',
    p: 'How much AI is being used, by whom, what it costs, how fast it responds, and whether quality is drifting over time.' },
  { f: 'finops', tag: 'FINOPS', h: 'Cost stays under control',
    p: 'Virtual API keys per person or team, each with a budget, and per-user billing — so AI spend never surprises you.' },
  { f: 'reports', tag: 'REPORTS', h: 'Audit-ready in one click',
    p: 'Regulator-ready exports of what the AI did and what data moved — for audits and compliance reviews.' },
  { f: 'lineage', tag: 'LINEAGE', h: 'Trace any answer to its source',
    p: 'Follow an answer back through the model, the data, and the exact document it came from. Full provenance, end to end.' },
  { f: 'regulatory', tag: 'REGULATORY', h: 'The compliance view',
    p: 'Map AI usage to regulatory frameworks — the home for your DPO — with provenance you can actually prove.' },
  { f: 'integrations', tag: 'INTEGRATIONS', h: 'Plug into your stack',
    p: 'Connect Off Grid to the tools you already use, with response caching and live status for each connection.' },
  { f: 'admin', tag: 'ADMIN', h: 'Who can do what',
    p: 'SSO, roles, and fine-grained access rules (ABAC) — with a tester so you can check a rule before it goes live.' },
  { outro: true },
];

const css = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1600px;height:900px;overflow:hidden;background:#fff;font-family:Menlo,'SF Mono',monospace;color:#0a0a0a}
.stage{width:1600px;height:900px;position:relative}
.slide{position:absolute;inset:0;opacity:0;transition:opacity .5s ease;display:flex;flex-direction:column;padding:54px 72px}
.slide.on{opacity:1}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px}
.chip{width:26px;height:20px;border-radius:5px;background:#059669;position:relative}
.chip:before,.chip:after{content:'';position:absolute;top:5px;width:5px;height:10px;background:#fff}
.chip:before{left:6px}.chip:after{right:6px}
.count{font-size:13px;color:#9ca3af;letter-spacing:.08em}
.tag{font-size:13px;letter-spacing:.18em;color:#059669;font-weight:700;margin-bottom:8px}
.h{font-size:38px;font-weight:700;line-height:1.1;margin-bottom:12px;letter-spacing:-.01em}
.p{font-size:19px;line-height:1.5;color:#4b5563;max-width:1180px;margin-bottom:22px}
.shot{flex:1;border:1px solid #ececec;border-radius:14px;overflow:hidden;box-shadow:0 18px 50px -24px rgba(0,0,0,.28);background:#fafafa}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top left;display:block}
.bar{position:absolute;left:0;bottom:0;height:5px;background:#059669;width:0}
/* intro / outro */
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:18px}
.big{font-size:64px;font-weight:700;letter-spacing:-.02em}
.sub{font-size:24px;color:#4b5563;max-width:980px;line-height:1.45}
.kicker{font-size:14px;letter-spacing:.22em;color:#059669;font-weight:700}
.foot{font-size:14px;color:#9ca3af;letter-spacing:.06em;margin-top:8px}
`;

function slideHtml(s, i, n) {
  const counter = `<span class="count">${i}/${n - 2 < 0 ? 0 : n - 2}</span>`;
  if (s.intro)
    return `<section class="slide" data-i="${i}"><div class="center">
      <div class="brand" style="font-size:28px"><span class="chip"></span> Off Grid <span style="color:#9ca3af;font-weight:400">CONSOLE</span></div>
      <div class="big">Your company's private AI,<br>controlled from one place.</div>
      <div class="sub">Everything runs on your own devices — no cloud, no accounts. This is the control plane: see it, govern it, prove it. A quick tour.</div>
      <div class="foot">ON-PREM · LOCAL-FIRST</div></div></section>`;
  if (s.outro)
    return `<section class="slide" data-i="${i}"><div class="center">
      <div class="kicker">SEES · REMEMBERS · MOVES · ACTS</div>
      <div class="big">One private AI layer<br>for the whole company.</div>
      <div class="sub">Fleet, gateway, guardrails, data, knowledge, agents, observability, cost, compliance — all on your own hardware.</div>
      <div class="brand" style="margin-top:10px"><span class="chip"></span> Off Grid <span style="color:#9ca3af;font-weight:400">CONSOLE</span></div></div></section>`;
  return `<section class="slide" data-i="${i}">
    <div class="top"><div class="brand"><span class="chip"></span> Off Grid <span style="color:#9ca3af;font-weight:400">CONSOLE</span></div>${counter}</div>
    <div class="tag">${s.tag}</div><div class="h">${s.h}</div><div class="p">${s.p}</div>
    <div class="shot"><img src="${b64(s.f)}" alt=""></div>
    <div class="bar"></div></section>`;
}

const n = SLIDES.length;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div class="stage">${SLIDES.map((s, i) => slideHtml(s, i, n)).join('')}</div>
<script>
const S=${SECONDS}*1000, slides=[...document.querySelectorAll('.slide')];
let i=0; window.__done=false;
function show(k){slides.forEach((s,j)=>s.classList.toggle('on',j===k));const b=slides[k].querySelector('.bar');if(b){b.style.transition='none';b.style.width='0';requestAnimationFrame(()=>{b.style.transition='width '+(S/1000)+'s linear';b.style.width='100%';});}}
show(0);
const t=setInterval(()=>{i++;if(i>=slides.length){window.__done=true;clearInterval(t);return;}show(i);},S);
</script></body></html>`;
writeFileSync(process.env.OUT || '/tmp/explainer.html', html);
console.log('wrote explainer with', n, 'slides (', SECONDS, 's each, ~', n * SECONDS, 's total )');
