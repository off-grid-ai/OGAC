// ─── Agent tools catalog — the PURE bridge from an agent's tool refs to the planner's view ──────
//
// The agent-loop planner (agent-loop.ts) needs a description of each tool it may call: a ref, a name,
// a description, and the arg keys. An agent declares its tools as a list of REFS in the pipeline's
// shared ref space (`prim:<id>` primitives, `app:<id>` apps-as-tools, `tool:<id>` registry tools).
//
// This module turns that list of refs into `AgentTool[]` for the planner — REUSING the existing pure
// primitive catalog (tool-primitives.ts) rather than duplicating it. It is PURE (zero I/O): registry
// (`tool:<id>`) + app (`app:<id>`) descriptors are looked up from an OPTIONAL catalog the caller
// passes in (resolved via I/O in agentrun.ts), so this stays unit-testable with plain data.
//
// AIR-GAP GOVERNANCE, by construction: a primitive ref is only turned into a callable tool when the
// pure `isPrimitiveEnabled(primitive, env)` gate says it's available on THIS deployment. A disabled
// internet primitive is dropped from the planner's tool list entirely — so the planner is never even
// told it exists, and therefore cannot choose it. The tool-execution adapter re-checks the same gate,
// so this is defence-in-depth, not the only guard.

import type { AgentTool } from '@/lib/agent-loop';
import {
  getPrimitive,
  isPrimitiveEnabled,
  isPrimitiveRef,
  parsePrimitiveRef,
} from '@/lib/tool-primitives';
import { isAppToolRef as isAppRef } from '@/lib/app-tools';

// A registry-tool descriptor the caller resolves (from the tools table) and passes in. Kept minimal +
// plain so this module stays pure. `ref` is `tool:<id>`.
export interface RegistryToolInfo {
  ref: string;
  name: string;
  description: string;
}

// An app-as-tool descriptor the caller resolves (from the apps store) and passes in. `ref` is
// `app:<id>`.
export interface AppToolInfo {
  ref: string;
  name: string;
  description: string;
}

export interface CatalogInputs {
  /** The tool refs the agent declares (from AgentDef.tools / inlineAgent.tools). */
  refs: string[];
  /** Env snapshot for the air-gap gate over primitives (defaults to {} — nothing internet-reaching). */
  env?: Record<string, string | undefined>;
  /** Optional registry-tool descriptors, keyed by ref, the caller resolved via I/O. */
  registryTools?: RegistryToolInfo[];
  /** Optional app-as-tool descriptors, keyed by ref, the caller resolved via I/O. */
  appTools?: AppToolInfo[];
}

// A ref like `retrieval` / `summarize` (the built-in agent-def "tools" that are capabilities, not
// callable primitives) is NOT a loop tool — the loop only exposes refs it can actually dispatch
// through the governed tool path (prim/app/tool). Everything else is ignored here.
function isDispatchableRef(ref: string): boolean {
  return isPrimitiveRef(ref) || isAppRef(ref) || ref.startsWith('tool:');
}

// ─── buildAgentToolCatalog — turn an agent's declared refs into the planner's AgentTool[] (PURE) ──
// Only DISPATCHABLE + AVAILABLE tools make the list:
//   • prim:<id> → included iff the primitive exists AND isPrimitiveEnabled(env) (air-gap gate);
//   • app:<id>  → included iff the caller supplied a descriptor for it;
//   • tool:<id> → included iff the caller supplied a descriptor for it;
//   • anything else (capability tags like `retrieval`) → dropped.
// De-dupes by ref, preserves declaration order.
export function buildAgentToolCatalog(inputs: CatalogInputs): AgentTool[] {
  const env = inputs.env ?? {};
  const registry = new Map((inputs.registryTools ?? []).map((t) => [t.ref, t]));
  const apps = new Map((inputs.appTools ?? []).map((t) => [t.ref, t]));
  const out: AgentTool[] = [];
  const seen = new Set<string>();

  for (const ref of inputs.refs) {
    if (seen.has(ref) || !isDispatchableRef(ref)) continue;

    if (isPrimitiveRef(ref)) {
      const id = parsePrimitiveRef(ref)!;
      const prim = getPrimitive(id);
      // Air-gap gate: only expose a primitive the deployment actually permits.
      if (!prim || !isPrimitiveEnabled(prim, env)) continue;
      out.push({
        ref,
        name: prim.name,
        description: prim.description,
        paramKeys: prim.params.map((p) => p.key),
      });
      seen.add(ref);
      continue;
    }

    if (isAppRef(ref)) {
      const info = apps.get(ref);
      if (!info) continue; // no descriptor → not exposed (unpublished / not in org)
      out.push({ ref, name: info.name, description: info.description, paramKeys: ['query'] });
      seen.add(ref);
      continue;
    }

    // tool:<id> registry tool
    const info = registry.get(ref);
    if (!info) continue;
    out.push({ ref, name: info.name, description: info.description });
    seen.add(ref);
  }

  return out;
}

// ─── isAutonomousAgent — the PURE predicate deciding when to run the ReAct loop vs the linear pass ─
// An agent runs the autonomous loop when it has ≥1 dispatchable tool available to the planner. With
// no callable tools the loop would degenerate to a single "finish" turn, so the existing linear path
// (retrieve → compose → ground) is kept — cheaper and unchanged. Callers pass the ALREADY-RESOLVED
// catalog (post air-gap gate) so "available" means genuinely callable, not merely declared.
export function isAutonomousAgent(catalog: AgentTool[]): boolean {
  return catalog.length > 0;
}
