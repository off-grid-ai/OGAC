// Off Grid gateway aggregator — one OpenAI-compatible endpoint that routes across the
// gateway pool by model + modality. Dependency-free (Node http). Runs on S1 as a service.
//
//   text request            -> round-robin the text gateways (g1, g2)
//   request with an image    -> a vision gateway (qwen-vision g2, or gemma g3 if named)
//   model names "gemma…"     -> g3   |   model names "qwen…" + image -> g2
//
// Adds `x-offgrid-gateway` to responses so you can see where each call went.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8800);
const HOST_HINT = process.env.HOST_HINT || '127.0.0.1'; // for display in info URLs only
// role map — one model per gateway (edit IPs via OFFGRID_POOL JSON if they change)
const POOL = JSON.parse(process.env.OFFGRID_POOL || JSON.stringify([
  { name: 'g1', host: '192.168.1.57', port: 7878, vision: false, model: 'qwen3.5-9b' },
  { name: 'g2', host: '192.168.1.58', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g3', host: '192.168.1.32', port: 7878, vision: true, model: 'gemma-4-e4b' },
]));
const TEXT = POOL.filter((g) => ['g1', 'g2'].includes(g.name));
let rr = 0;

const hasImage = (b) => {
  try { return /"type"\s*:\s*"(image_url|input_image|image)"/.test(JSON.stringify(b.messages || [])); }
  catch { return false; }
};
function pick(model, image) {
  const m = (model || '').toLowerCase();
  if (m.includes('gemma')) return POOL.find((g) => g.name === 'g3');
  if (image) {
    if (m.includes('gemma')) return POOL.find((g) => g.name === 'g3');
    return POOL.find((g) => g.vision); // g2: qwen text+vision (default vision node)
  }
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
  if (req.url === '/v1/models')
    return json(res, 200, { object: 'list', data: [
      { id: 'qwen3.5-9b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'qwen3.5-9b').map((g) => g.name) },
      { id: 'gemma-4-e4b', object: 'model', owned_by: 'offgrid', capabilities: ['text', 'vision'], gateways: POOL.filter((g) => g.model === 'gemma-4-e4b').map((g) => g.name) },
    ] });

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch { /* not json */ }
    const target = pick(body.model, hasImage(body)) || POOL[0];
    const opts = { host: target.host, port: target.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}` } };
    const up = http.request(opts, (ur) => {
      res.writeHead(ur.statusCode || 502, { ...ur.headers, 'x-offgrid-gateway': target.name, 'x-offgrid-model': target.model });
      ur.pipe(res);
    });
    up.on('error', (e) => json(res, 502, { error: { message: `gateway ${target.name} (${target.host}) error: ${e.message}`, type: 'upstream_error' } }));
    up.setTimeout(120000, () => up.destroy(new Error('upstream timeout')));
    up.end(raw);
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`[aggregator] routing on 0.0.0.0:${PORT} across`, POOL.map((g) => `${g.name}:${g.model}${g.vision ? '+vision' : ''}`).join(', ')));
