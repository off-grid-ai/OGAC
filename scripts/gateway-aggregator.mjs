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

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health')
    return poolInfo().then((i) => json(res, 200, i)).catch(() => json(res, 200, { name: 'Off Grid AI — gateway aggregator', routes: POOL }));
  if (req.url === '/traffic' || req.url === '/traffic.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(trafficJSON()));
  }
  if (req.url === '/v1/models')
    return json(res, 200, {
      object: 'list', data: [
        { id: 'gemma-4-12b', object: 'model', owned_by: 'offgrid', capabilities: ['text'], gateways: POOL.filter((g) => g.model === 'gemma-4-12b').map((g) => g.name) },
        { id: 'qwen3.5-9b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'qwen3.5-9b').map((g) => g.name) },
        { id: 'gemma-4-e4b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'gemma-4-e4b').map((g) => g.name) },
      ]
    });

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
    // Gemma 4 (and others) reject system messages not at position 0 — clients
    // like Claude Code intersperse them mid-conversation. Consolidate to front.
    // Handle both string content and multipart array content [{type:"text",text:"..."}].
    let forwarded = raw;
    if (Array.isArray(body.messages)) {
      const sysTexts = []; const rest = [];
      let needsFix = false;
      let seenNonSystem = false;
      for (const m of body.messages) {
        if (m.role === 'system') {
          if (seenNonSystem) needsFix = true; // system after non-system = bad
          let text = '';
          if (typeof m.content === 'string') text = m.content;
          else if (Array.isArray(m.content)) text = m.content.filter(p => p && p.type === 'text' && p.text).map(p => p.text).join('\n');
          if (text.trim()) sysTexts.push(text.trim());
        } else {
          seenNonSystem = true;
          rest.push(m);
        }
      }
      if (needsFix && sysTexts.length > 0) {
        body.messages = [{ role: 'system', content: sysTexts.join('\n\n') }, ...rest];
        forwarded = Buffer.from(JSON.stringify(body));
      } else if (needsFix) {
        // System messages exist mid-conversation but have no extractable text — just remove them
        body.messages = rest;
        forwarded = Buffer.from(JSON.stringify(body));
      }
    }
    const opts = {
      host: target.host, port: target.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}`, 'content-length': forwarded.length }
    };
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
    up.end(forwarded);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`[aggregator] routing on 0.0.0.0:${PORT} across`, POOL.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}`).join(', ')));
