import { regexScan } from './pii-regex';
import { GUARDRAIL_ENTRIES } from './services';
import type { PiiPort } from './types';

// Content guardrails run through the guardrails port. LLM Guard is THE authoritative engine
// (adapters/guardrail-provider.ts) — see PII_PORTS at the bottom. This file additionally exposes the
// pure regex FLOOR as a lightweight, engine-agnostic detector `regexPii` for the DATA-MOVEMENT
// redaction path (data-redaction.ts) — NOT as a competing content-guardrail engine. The regex floor
// (regexScan, isolated in pii-regex.ts so it's unit-testable with no mocks) does deterministic span
// redaction over row values; it never reaches a network service.

function metaOf(id: string) {
  const entry = GUARDRAIL_ENTRIES.find((e) => e.meta.id === id);
  if (!entry) throw new Error(`guardrails adapter meta '${id}' missing`);
  return entry.meta;
}

// The regex floor as a PiiPort — used ONLY by the data-movement redaction path as a zero-dependency
// detector, and as a fixture in tests. It is NOT registered as a selectable content-guardrail engine
// (LLM Guard is the sole engine). Reports engine:'regex' so a consumer can tell it apart.
export const regexPii: PiiPort = {
  meta: metaOf('regex-floor'),
  async scan(text) {
    // The regex floor is org-agnostic (no custom recognizers), so it ignores any orgId.
    return { ...regexScan(text), status: 'applied', scope: 'data-redaction' };
  },
  async health() {
    return true;
  },
};

import { llmGuardPii } from './guardrail-provider';

// The guardrails capability has exactly ONE real engine: LLM Guard. The DIP port stays so the checks
// spine is engine-agnostic, but there is no regex/Presidio/BYO-http fall-open — LLM Guard is the door
// (fail-closed when configured-but-down; explicit "not configured" when no URL is set).
export const PII_PORTS: PiiPort[] = [llmGuardPii];

// Data movement has a distinct adapter selection from content guardrails. Presidio is never added to
// PII_PORTS, so choosing it for row anonymization cannot weaken or duplicate LLM Guard policy.
export async function getDataRedactionPii(env: NodeJS.ProcessEnv = process.env): Promise<PiiPort> {
  const selected = env.OFFGRID_ADAPTER_DATA_REDACTION?.trim().toLowerCase();
  const configured = Boolean(env.OFFGRID_PRESIDIO_ANALYZER_URL ?? env.OFFGRID_PRESIDIO_URL);
  if (selected === 'presidio' || (!selected && configured)) {
    const { presidioDataPii } = await import('./presidio');
    return presidioDataPii;
  }
  return regexPii;
}
