// SINGLE SOURCE OF TRUTH for the on-prem fleet node pool (the 8 OpenAI-compatible nodes on :7878).
//
// This is plain ESM JS on purpose: it is imported BOTH by the hand-rolled runner
// (scripts/cluster-gateway.mjs, run by node with no type-strip) AND by the LiteLLM config
// generator (src/lib/fleet-pool.ts, compiled by Next/tsc with allowJs). Neither may re-declare
// the pool — DRY: one array, two consumers. Override at runtime with OFFGRID_POOL (JSON).
//
// Shape: { name, host, port, vision, model } — the same shape @offgrid/gateway's cluster pool and
// LiteLLM's model_list both key off. `model` is the node's routing tag (the served model id).

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
  { name: 'g8', host: '192.168.1.64', port: 7878, vision: true, model: 'qwythos-9b' },
];
