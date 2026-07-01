// Off Grid gateway aggregator — one OpenAI-compatible endpoint that routes across the
// gateway pool by model + modality. Dependency-free (Node http). Runs on S1 as a service.
//
//   text request            -> round-robin the text gateways (g1 Gemma 12B, g2 Qwen 9B)
//   request with an image    -> a vision gateway (g2 Qwen, or g3 Gemma E4B if named)
//   model names "gemma…" text -> g1 (Gemma 12B)  |  "qwen…" -> g2  |  image+gemma -> g3
//
// Adds `x-offgrid-gateway` to responses so you can see where each call went.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8800);
const HOST_HINT = process.env.HOST_HINT || '127.0.0.1'; // for display in info URLs only
// role map — one model per gateway (edit IPs via OFFGRID_POOL JSON if they change)
const POOL = JSON.parse(process.env.OFFGRID_POOL || JSON.stringify([
  { name: 'g1', host: '192.168.1.57', port: 7878, vision: false, model: 'gemma-4-12b' },
  { name: 'g2', host: '192.168.1.58', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g3', host: '192.168.1.32', port: 7878, vision: true, model: 'gemma-4-e4b' },
]));
const TEXT = POOL.filter((g) => ['g1', 'g2'].includes(g.name));
let rr = 0;

// --- traffic monitoring: rolling log of recent calls + per-gateway counters ---
const LOG = [];        // last N proxied requests (newest last)
const LOG_MAX = 300;
const STATS = {};      // per-gateway { requests, errors, totalMs, tokens }
const startedAt = Date.now();
function record(e) {
  e.ts = Date.now();
  LOG.push(e);
  if (LOG.length > LOG_MAX) LOG.shift();
  const s = (STATS[e.gateway] ||= { requests: 0, errors: 0, totalMs: 0, tokens: 0 });
  s.requests += 1;
  if (!e.status || e.status >= 400) s.errors += 1;
  s.totalMs += e.ms;
  if (e.tokens) s.tokens += e.tokens;
  console.log(`[req] ${new Date(e.ts).toISOString()} ${e.gateway} ${e.model} ${e.kind} ${e.status} ${e.ms}ms ${e.bytes}b${e.tokens ? ` tok=${e.tokens}` : ''}`);
}
function trafficJSON() {
  return {
    since: new Date(startedAt).toISOString(),
    pool: POOL.map((g) => ({ name: g.name, model: g.model, vision: g.vision })),
    stats: POOL.map((g) => {
      const s = STATS[g.name] || { requests: 0, errors: 0, totalMs: 0, tokens: 0 };
      return { gateway: g.name, model: g.model, ...s, avgMs: s.requests ? Math.round(s.totalMs / s.requests) : 0 };
    }),
    recent: LOG.slice().reverse(),
  };
}

const hasImage = (b) => {
  try { return /"type"\s*:\s*"(image_url|input_image|image)"/.test(JSON.stringify(b.messages || [])); }
  catch { return false; }
};
function pick(model, image) {
  const m = (model || '').toLowerCase();
  if (image) {
    if (m.includes('gemma')) return POOL.find((g) => g.name === 'g3'); // Gemma E4B vision
    return POOL.find((g) => g.vision); // g2: Qwen text+vision (default vision node)
  }
  if (m.includes('gemma')) return POOL.find((g) => g.name === 'g1'); // Gemma 12B text
  if (m.includes('qwen')) return POOL.find((g) => g.name === 'g2');
  return TEXT[rr++ % TEXT.length]; // text: round-robin g1/g2
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// Fetch each gateway's own info JSON (modalities) and merge — so the console Gateway
// page renders the full modality grid even though it's talking to the aggregator.
async function poolInfo() {
  const infos = await Promise.all(POOL.map(async (g) => {
    try {
      const r = await fetch(`http://${g.host}:${g.port}/`, { signal: AbortSignal.timeout(1500) });
      return { g, info: r.ok ? await r.json() : null };
    } catch { return { g, info: null }; }
  }));
  const modalities = {};
  for (const { info } of infos) for (const [k, v] of Object.entries(info?.modalities || {}))
    if (v === 'ready' || !modalities[k]) modalities[k] = v;
  return {
    name: 'Off Grid AI — gateway aggregator',
    openai_compatible: true,
    base_url: `http://${HOST_HINT}:${PORT}/v1`,
    docs: `http://${HOST_HINT}:${PORT}/v1`,
    mcp: `http://${HOST_HINT}:${PORT}/mcp`,
    modalities: Object.keys(modalities).length ? modalities : { text: 'ready', vision_understanding: 'ready' },
    image_models: [],
    gateways: infos.map(({ g, info }) => ({ name: g.name, host: g.host, model: g.model, vision: g.vision, up: !!info })),
  };
}

const TRAFFIC_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Off Grid — Gateway Traffic</title>
<style>
  :root{--bg:#000;--fg:#e5e7eb;--dim:#6b7280;--acc:#34D399;--line:#1f2937;--err:#f87171}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.5 Menlo,ui-monospace,monospace;padding:20px}
  h1{font-size:15px;font-weight:600;margin:0 0 2px;letter-spacing:.02em}
  h1 .acc{color:var(--acc)}
  .sub{color:var(--dim);font-size:11px;margin-bottom:18px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:20px}
  .card{border:1px solid var(--line);padding:12px 14px}
  .card .g{color:var(--acc);font-weight:600}
  .card .m{color:var(--dim);font-size:11px;margin-bottom:8px}
  .card .row{display:flex;justify-content:space-between}
  .card .row span:first-child{color:var(--dim)}
  .card .err{color:var(--err)}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:var(--dim);font-weight:500;border-bottom:1px solid var(--line);padding:6px 8px;position:sticky;top:0;background:var(--bg)}
  td{padding:5px 8px;border-bottom:1px solid #0d1117;white-space:nowrap}
  .gw{color:var(--acc)}
  .bad{color:var(--err)}
  .wrap{overflow-x:auto;border:1px solid var(--line)}
  .pill{display:inline-block;padding:0 6px;border:1px solid var(--line);border-radius:2px;color:var(--dim);font-size:11px}
  .live{color:var(--acc);font-size:11px}
</style></head><body>
<h1>Off Grid <span class="acc">// gateway traffic</span></h1>
<div class="sub">every call the console makes flows through the :8800 aggregator · <span class="live">● live</span> <span id="since"></span></div>
<div class="cards" id="cards"></div>
<div class="wrap"><table>
  <thead><tr><th>time</th><th>gateway</th><th>model</th><th>kind</th><th>status</th><th>latency</th><th>tokens</th><th>bytes</th></tr></thead>
  <tbody id="rows"></tbody>
</table></div>
<script>
const fmtT = (iso) => new Date(iso).toLocaleTimeString();
async function tick(){
  try{
    const d = await (await fetch('/traffic')).json();
    document.getElementById('since').textContent = 'since ' + fmtT(d.since);
    document.getElementById('cards').innerHTML = d.stats.map(s => \`
      <div class="card"><div class="g">\${s.gateway}</div><div class="m">\${s.model}</div>
        <div class="row"><span>requests</span><span>\${s.requests}</span></div>
        <div class="row"><span>errors</span><span class="\${s.errors?'err':''}">\${s.errors}</span></div>
        <div class="row"><span>avg latency</span><span>\${s.avgMs} ms</span></div>
        <div class="row"><span>tokens</span><span>\${s.tokens}</span></div>
      </div>\`).join('');
    document.getElementById('rows').innerHTML = d.recent.length ? d.recent.map(r => \`
      <tr><td>\${fmtT(r.ts?new Date(r.ts).toISOString():d.since)}</td>
        <td class="gw">\${r.gateway}</td><td>\${r.model||''}</td><td>\${r.kind}</td>
        <td class="\${(!r.status||r.status>=400)?'bad':''}">\${r.status}</td>
        <td>\${r.ms} ms</td><td>\${r.tokens||''}</td><td>\${r.bytes}</td></tr>\`).join('')
      : '<tr><td colspan="8" style="color:var(--dim);padding:14px">no traffic yet — make a call through http://127.0.0.1:8800/v1</td></tr>';
  }catch(e){ document.getElementById('since').textContent = '(aggregator unreachable)'; }
}
tick(); setInterval(tick, 2000);
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health')
    return poolInfo().then((i) => json(res, 200, i)).catch(() => json(res, 200, { name: 'Off Grid AI — gateway aggregator', routes: POOL }));
  if (req.url === '/traffic' || req.url === '/traffic.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(trafficJSON()));
  }
  if (req.url === '/traffic/live' || req.url === '/live') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(TRAFFIC_HTML);
  }
  if (req.url === '/v1/models')
    return json(res, 200, { object: 'list', data: [
      { id: 'gemma-4-12b', object: 'model', owned_by: 'offgrid', capabilities: ['text'], gateways: POOL.filter((g) => g.model === 'gemma-4-12b').map((g) => g.name) },
      { id: 'qwen3.5-9b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'qwen3.5-9b').map((g) => g.name) },
      { id: 'gemma-4-e4b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'gemma-4-e4b').map((g) => g.name) },
    ] });

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch { /* not json */ }
    const image = hasImage(body);
    const target = pick(body.model, image) || POOL[0];
    const kind = image ? 'image' : 'text';
    const started = Date.now();
    const streaming = body.stream === true;
    const opts = { host: target.host, port: target.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}` } };
    const up = http.request(opts, (ur) => {
      res.writeHead(ur.statusCode || 502, { ...ur.headers, 'x-offgrid-gateway': target.name, 'x-offgrid-model': target.model });
      let bytes = 0; const buf = [];
      ur.on('data', (c) => { bytes += c.length; res.write(c); if (!streaming) buf.push(c); });
      ur.on('end', () => {
        res.end();
        let tokens = 0;
        if (!streaming) { try { tokens = JSON.parse(Buffer.concat(buf).toString())?.usage?.total_tokens || 0; } catch { /* non-json */ } }
        record({ gateway: target.name, model: body.model || target.model, kind, status: ur.statusCode || 0, ms: Date.now() - started, bytes, tokens });
      });
    });
    up.on('error', (e) => {
      record({ gateway: target.name, model: body.model || target.model, kind, status: 502, ms: Date.now() - started, bytes: 0, tokens: 0 });
      json(res, 502, { error: { message: `gateway ${target.name} (${target.host}) error: ${e.message}`, type: 'upstream_error' } });
    });
    up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')));
    up.end(raw);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`[aggregator] routing on 0.0.0.0:${PORT} across`, POOL.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}`).join(', ')));
