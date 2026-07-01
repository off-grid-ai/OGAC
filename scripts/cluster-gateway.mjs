// Off Grid cluster gateway runner — the console importing @offgrid/gateway.
//
// This is the drop-in replacement for the old loose scripts/gateway-aggregator.mjs:
// same OpenAI-compatible :8800 endpoint, same node pool, but now backed by the
// standalone @offgrid/gateway package (cluster mode). Routing, true health, and
// plug-and-play observability all live in the package; this file only supplies
// the fleet's node pool + wires the OpenSearch/Langfuse sinks via env.
//
//   node scripts/cluster-gateway.mjs
//
// Observability is automatic from env (see @offgrid/gateway/observability):
//   OFFGRID_OPENSEARCH_URL, OFFGRID_GATEWAY_INDEX
//   OFFGRID_LANGFUSE_URL, OFFGRID_LANGFUSE_PUBLIC_KEY, OFFGRID_LANGFUSE_SECRET_KEY
import { createClusterGateway } from '@offgrid/gateway';

// The on-prem fleet pool. Override with OFFGRID_POOL (JSON) without editing code.
const POOL = [
  { name: 'g1', host: '192.168.1.57', port: 7878, vision: true, model: 'qwythos-9b' },
  { name: 'g2', host: '192.168.1.58', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g3', host: '192.168.1.32', port: 7878, vision: true, model: 'gemma-4-e4b' },
  { name: 'g4', host: '192.168.1.63', port: 7878, vision: true, model: 'gemma-4-e4b', enabled: false },
  { name: 'g5', host: '192.168.1.65', port: 7878, vision: true, model: 'qwen3.5-9b', enabled: false },
  { name: 'g6', host: '192.168.1.66', port: 7878, vision: false, model: 'qwen3-coder', enabled: false },
  { name: 'g7', host: '192.168.1.62', port: 7878, vision: false, model: 'qwen3-coder', enabled: false },
  { name: 'g8', host: '192.168.1.64', port: 7878, vision: true, model: 'qwythos-9b', enabled: false },
];

createClusterGateway({
  pool: process.env.OFFGRID_POOL ? JSON.parse(process.env.OFFGRID_POOL) : POOL,
  port: Number(process.env.PORT || 8800),
  hostHint: process.env.HOST_HINT || '127.0.0.1',
}).listen();
