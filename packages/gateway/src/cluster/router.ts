// Model + modality routing across the live pool, with per-model round-robin.
//
//   image request           -> a vision node (matching the named family if given)
//   model "gemma…"          -> a gemma node
//   model "…coder…"         -> a qwen3-coder node
//   model "qwen…"           -> a qwen3.5 node
//   model "qwythos…"        -> a qwythos node
//   unspecified             -> round-robin the whole live pool
import type { GatewayNode } from './types';

export class Router {
  private rr: Record<string, number> = {};

  constructor(private readonly live: GatewayNode[]) {}

  private rrPick(nodes: GatewayNode[]): GatewayNode | undefined {
    if (!nodes.length) return undefined;
    const k = nodes.map((g) => g.name).join(',');
    this.rr[k] = ((this.rr[k] || 0) + 1) % nodes.length;
    return nodes[this.rr[k]];
  }

  /** The eligible nodes for a request (the family that can serve it). */
  candidates(model: string | undefined, image: boolean): GatewayNode[] {
    const m = (model || '').toLowerCase();
    const byModel = (tag: string): GatewayNode[] => this.live.filter((g) => g.model.includes(tag));
    if (image) {
      if (m.includes('gemma')) return this.live.filter((g) => g.model.includes('gemma') && g.vision);
      if (m.includes('qwen')) return this.live.filter((g) => g.model.includes('qwen') && g.vision);
      return this.live.filter((g) => g.vision);
    }
    if (m.includes('gemma')) return byModel('gemma');
    if (m.includes('coder')) return byModel('qwen3-coder');
    if (m.includes('qwen')) return byModel('qwen3.5');
    if (m.includes('qwythos')) return byModel('qwythos');
    return this.live;
  }

  pick(model: string | undefined, image: boolean): GatewayNode | undefined {
    return this.rrPick(this.candidates(model, image));
  }

  /** Load-aware pick: the least-loaded node in the family (round-robin breaks ties).
   *  This spreads pressure off a saturating node before it jams. */
  pickLeastLoaded(model: string | undefined, image: boolean, load: (name: string) => number): GatewayNode | undefined {
    const c = this.candidates(model, image);
    if (c.length <= 1) return c[0] ?? this.rrPick(this.live);
    let min = Infinity;
    for (const g of c) min = Math.min(min, load(g.name));
    const leastLoaded = c.filter((g) => load(g.name) === min);
    return this.rrPick(leastLoaded);
  }
}

/** Detect an image part in an OpenAI chat body (multipart content). */
export function hasImage(body: { messages?: unknown }): boolean {
  try {
    return /"type"\s*:\s*"(image_url|input_image|image)"/.test(JSON.stringify(body.messages || []));
  } catch {
    return false;
  }
}
