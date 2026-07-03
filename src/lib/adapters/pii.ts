import { regexScan } from './pii-regex';
import { GUARDRAIL_ENTRIES } from './services';
import type { PiiPort } from './types';

// PII detection behind the guardrails port. The first-party regex scan (regexScan, isolated in
// pii-regex.ts so it's unit-testable with no mocks) is the always-on default; Presidio is a
// behavior swap-in (OFFGRID_ADAPTER_GUARDRAILS=presidio) that performs the real
// detection/anonymization over HTTP — with a graceful fall back to the regex if it's unreachable,
// so turning Presidio on can never harden into a hard dependency.
const env = process.env;

function metaOf(id: string) {
  const entry = GUARDRAIL_ENTRIES.find((e) => e.meta.id === id);
  if (!entry) throw new Error(`guardrails adapter meta '${id}' missing`);
  return entry.meta;
}

export const regexPii: PiiPort = {
  meta: metaOf('checks'),
  async scan(text) {
    return regexScan(text);
  },
  async health() {
    return true;
  },
};

interface PresidioEntity {
  entity_type: string;
}

// Presidio analyzer → list of detected entity types. Anonymizer (separate service in compose) is
// optional; we ask the analyzer and synthesize a redaction so one URL is enough to get value.
async function presidioAnalyze(url: string, text: string): Promise<string[]> {
  const res = await fetch(`${url}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language: 'en' }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`presidio ${res.status}`);
  const found = (await res.json()) as PresidioEntity[];
  return [...new Set(found.map((f) => f.entity_type))];
}

export const presidioPii: PiiPort = {
  meta: metaOf('presidio'),
  async scan(text) {
    const url = env.OFFGRID_PRESIDIO_URL;
    if (!url) return regexScan(text);
    try {
      const entities = await presidioAnalyze(url, text);
      return { hits: entities.length > 0, entities, engine: 'presidio' };
    } catch {
      // Never let a flaky detector break the request path — degrade to the regex floor.
      return regexScan(text);
    }
  },
  async health() {
    const url = env.OFFGRID_PRESIDIO_URL;
    if (!url) return false;
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export const PII_PORTS: PiiPort[] = [regexPii, presidioPii];
