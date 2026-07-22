// Thin I/O SEAM for cloud egress-DLP enforcement. The ONLY module here that touches the guardrail
// engine: it reuses getPii().scan() (THE authoritative redactor — no re-implemented redaction) to
// sanitize the outbound payload, then delegates the ALLOW/MASK/BLOCK verdict to the pure
// `enforceEgressDlp`. It is called at the cloud-egress seam (chat/stream route) right before a
// request would leave the box; on-prem calls never reach here, so on-prem behaviour is unchanged.
//
// SOLID: the pure decision + PiiResult→EgressScan mapping + aggregate reducer are exported and
// unit-tested; the getPii() orchestration is the thin glue verified by integration.

import { getPii } from '@/lib/adapters/registry';
import type { PiiResult } from '@/lib/adapters/types';
import {
  type EgressDlpDecision,
  type EgressDlpPolicy,
  type EgressScan,
  enforceEgressDlp,
} from './egress-dlp';

/** A clean, screened scan — the identity element for the aggregate + the no-content short-circuit. */
const CLEAN_SCAN: EgressScan = {
  configured: true,
  reachable: true,
  hits: false,
  entities: [],
  sanitized: '',
};

/**
 * Map the guardrail's PiiResult onto the pure EgressScan the decision layer consumes. PURE.
 *   • configured — false ⇒ no engine URL set (cannot verify a cloud route ⇒ block downstream).
 *   • reachable  — false when the engine was configured but could not screen (`blocked` fail-closed)
 *                  OR not configured; true only for a real, produced verdict.
 *   • sanitized  — the engine's `redacted` text; the original when the engine returned none.
 */
export function egressScanFromPii(pii: PiiResult, original: string): EgressScan {
  const configured = pii.configured !== false;
  const reachable = configured && pii.blocked !== true;
  return {
    configured,
    reachable,
    hits: pii.hits === true,
    entities: Array.isArray(pii.entities) ? pii.entities : [],
    sanitized: typeof pii.redacted === 'string' ? pii.redacted : original,
  };
}

/**
 * Combine per-unit scans into one aggregate verdict for the whole payload. PURE. The payload is only
 * as safe as its weakest unit: NOT configured / NOT reachable if ANY unit was; a hit if ANY unit hit;
 * the union of masked entities. `sanitized` is not meaningful at the aggregate (each unit is rebuilt
 * from its OWN scan) so it is left empty. An empty set is a clean, screened aggregate.
 */
export function mergeEgressScans(scans: EgressScan[]): EgressScan {
  if (!scans.length) return { ...CLEAN_SCAN };
  const entities = new Set<string>();
  let configured = true;
  let reachable = true;
  let hits = false;
  for (const s of scans) {
    if (!s.configured) configured = false;
    if (!s.reachable) reachable = false;
    if (s.hits) hits = true;
    for (const e of s.entities) entities.add(e);
  }
  return { configured, reachable, hits, entities: [...entities], sanitized: '' };
}

// A message with either a plain-string content or an array of content parts (chat payload shape).
export interface EgressMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

// One scannable text unit inside the payload + where to write its sanitized value back.
interface TextUnit {
  msgIdx: number;
  partIdx: number | null; // null ⇒ the message's content IS the string; else the array-part index
  text: string;
}

function isTextPart(p: unknown): p is { type: string; text: string } {
  return (
    !!p &&
    typeof p === 'object' &&
    (p as { type?: unknown }).type === 'text' &&
    typeof (p as { text?: unknown }).text === 'string'
  );
}

/** Collect every scannable text unit from the payload messages. PURE. */
export function collectTextUnits(messages: EgressMessage[]): TextUnit[] {
  const units: TextUnit[] = [];
  messages.forEach((m, msgIdx) => {
    if (typeof m.content === 'string') {
      if (m.content) units.push({ msgIdx, partIdx: null, text: m.content });
      return;
    }
    if (Array.isArray(m.content)) {
      m.content.forEach((part, partIdx) => {
        if (isTextPart(part) && part.text) units.push({ msgIdx, partIdx, text: part.text });
      });
    }
  });
  return units;
}

export interface SanitizeOutboundResult {
  decision: EgressDlpDecision;
  /** The payload to actually send: sanitized copy when masked, the original when passthrough. */
  messages: EgressMessage[];
  /** true ⇒ the cloud call must be REFUSED (fail-closed / strictness-block). */
  blocked: boolean;
}

/**
 * Sanitize a CLOUD-bound payload before it egresses. Scans each text unit through the guardrail
 * (reusing getPii().scan), reduces to one aggregate verdict via the pure layer, and:
 *   • BLOCKED  → returns blocked:true with the ORIGINAL messages (the caller refuses the call).
 *   • MASKED   → returns a deep-ish copy with each unit replaced by its guardrail-sanitized text.
 *   • PASSTHRU → returns the original messages unchanged.
 * `routeTarget` is always 'cloud' at this seam (on-prem never calls here), but is threaded so the
 * pure decision stays the single authority.
 */
export async function sanitizeOutboundMessages(
  messages: EgressMessage[],
  policy: EgressDlpPolicy,
  orgId: string,
): Promise<SanitizeOutboundResult> {
  const units = collectTextUnits(messages);
  // No outbound text ⇒ nothing can leak; screen as clean without calling the engine.
  if (!units.length) {
    const decision = enforceEgressDlp('cloud', '', policy, { ...CLEAN_SCAN });
    return { decision, messages, blocked: false };
  }

  const pii = getPii();
  const scans = await Promise.all(
    units.map(async (u): Promise<EgressScan> => {
      try {
        return egressScanFromPii(await pii.scan(u.text, orgId), u.text);
      } catch {
        // A thrown scan is an unreachable guardrail ⇒ fail closed (not configured/reachable).
        return { configured: true, reachable: false, hits: false, entities: [], sanitized: u.text };
      }
    }),
  );

  const aggregate = mergeEgressScans(scans);
  const decision = enforceEgressDlp('cloud', '', policy, aggregate);

  if (decision.action === 'blocked') {
    return { decision, messages, blocked: true };
  }
  if (decision.action !== 'masked') {
    // passthrough (DLP off, or screened-clean) — send the original payload unchanged.
    return { decision, messages, blocked: false };
  }

  // MASKED: rebuild the payload, replacing each text unit with its OWN guardrail-sanitized value.
  const out: EgressMessage[] = messages.map((m) => ({
    ...m,
    content: Array.isArray(m.content) ? m.content.map((p) => ({ ...(p as object) })) : m.content,
  }));
  units.forEach((u, i) => {
    const sanitized = scans[i].sanitized;
    if (u.partIdx === null) {
      out[u.msgIdx].content = sanitized;
    } else {
      (out[u.msgIdx].content as { text: string }[])[u.partIdx].text = sanitized;
    }
  });
  return { decision, messages: out, blocked: false };
}
