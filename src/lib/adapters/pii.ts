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
  start: number;
  end: number;
  score?: number;
}

// Presidio analyzer → the detected entities WITH positions (needed to redact spans).
async function presidioAnalyze(url: string, text: string): Promise<PresidioEntity[]> {
  const res = await fetch(`${url}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language: 'en' }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`presidio ${res.status}`);
  return (await res.json()) as PresidioEntity[];
}

// Presidio anonymizer service → redacted text. Falls back to null so the caller can synthesize.
async function presidioAnonymize(
  url: string,
  text: string,
  results: PresidioEntity[],
): Promise<string | null> {
  try {
    const res = await fetch(`${url}/anonymize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        analyzer_results: results.map((r) => ({
          entity_type: r.entity_type,
          start: r.start,
          end: r.end,
          score: r.score ?? 0.85,
        })),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return typeof data.text === 'string' ? data.text : null;
  } catch {
    return null;
  }
}

// Local span redaction from the analyzer positions — used when the anonymizer service isn't wired
// or is unreachable. Replace each detected span (right-to-left so offsets stay valid) with its type.
function redactSpans(text: string, results: PresidioEntity[]): string {
  return [...results]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, r) => acc.slice(0, r.start) + `[${r.entity_type}]` + acc.slice(r.end), text);
}

export const presidioPii: PiiPort = {
  meta: metaOf('presidio'),
  async scan(text) {
    const url = env.OFFGRID_PRESIDIO_URL;
    if (!url) return regexScan(text);
    try {
      const found = await presidioAnalyze(url, text);
      const entities = [...new Set(found.map((f) => f.entity_type))];
      // Prefer the real anonymizer service; else synthesize a redaction from the positions.
      const anonUrl = env.OFFGRID_PRESIDIO_ANONYMIZER_URL;
      const redacted =
        (anonUrl && found.length ? await presidioAnonymize(anonUrl, text, found) : null) ??
        (found.length ? redactSpans(text, found) : text);
      return { hits: entities.length > 0, entities, redacted, engine: 'presidio' };
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
