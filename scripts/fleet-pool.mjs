// SINGLE SOURCE OF TRUTH for the on-prem fleet node pool (the 8 OpenAI-compatible nodes on :7878).
//
// This is plain ESM JS on purpose so it can be imported by the LiteLLM config generator
// (src/lib/fleet-pool.ts, compiled by Next/tsc with allowJs) without a type-strip step. It is the
// one place the pool is declared — DRY: one array, its consumers reference it. Override at runtime
// with OFFGRID_POOL (JSON).
//
// Shape: { name, host, port, vision, model } — the same shape LiteLLM's model_list keys off.
// `model` is the node's routing tag (the served model id).

/**
 * @typedef {Object} FleetPoolNode
 * @property {string} name   Stable node id (g1..g8).
 * @property {string} host   LAN IP of the node.
 * @property {number} port   OpenAI-compatible port (7878 across the fleet).
 * @property {boolean} vision Whether the node's model accepts image input.
 * @property {string} model  The routing tag / served model id.
 */

/** @type {readonly FleetPoolNode[]} */
export const FLEET_POOL = [
  { name: 'g1', host: '192.168.1.57', port: 7878, vision: true, model: 'qwythos-9b' },
  { name: 'g2', host: '192.168.1.58', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g3', host: '192.168.1.32', port: 7878, vision: true, model: 'qwythos-9b' },
  { name: 'g4', host: '192.168.1.63', port: 7878, vision: true, model: 'qwythos-9b' },
  { name: 'g5', host: '192.168.1.65', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g6', host: '192.168.1.66', port: 7878, vision: true, model: 'qwen3.5-9b' },
  { name: 'g7', host: '192.168.1.62', port: 7878, vision: true, model: 'qwythos-9b' },
  // g8 (192.168.1.64) was pulled from the pool and repurposed as an Off Grid AI Desktop
  // test machine. It stays a known host (see the g8 display-name alias) but is no longer
  // served, so the gateway must not route to it.
];
