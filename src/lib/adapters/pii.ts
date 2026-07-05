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

import type {
  AnalyzeRequest,
  NormalizedRecognizer,
  ThresholdConfig,
} from '../presidio-recognizers';

interface PresidioEntity {
  entity_type: string;
  start: number;
  end: number;
  score?: number;
}

// A fetch timeout that survives environments where AbortSignal.timeout is unavailable. 8s is
// generous: Presidio's spaCy pipeline can be slow the first time it loads the NLP model, but a
// warm scan is sub-second — the old 4s could time out a cold model and silently drop us to regex.
const ANALYZE_TIMEOUT_MS = 8000;

// Presidio analyzer → the detected entities WITH positions (needed to redact spans). The request
// body is built by the pure builder in presidio-recognizers.ts so custom recognizers (regex +
// context words + deny lists) ride along as `ad_hoc_recognizers` — they take effect per-request
// with NO server-side Presidio config — and the global score_threshold prunes low-confidence hits.
// On a non-2xx we surface the response body: Presidio returns a JSON error naming exactly what it
// rejected (e.g. a malformed ad_hoc_recognizer), which is otherwise the black hole that silently
// drops the whole scan to the regex floor with no clue why.
async function presidioAnalyze(url: string, body: AnalyzeRequest): Promise<PresidioEntity[]> {
  const res = await fetch(`${url}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`presidio /analyze ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as PresidioEntity[];
}

// Load the org's custom recognizers + threshold config for the scan path. Best-effort BY DESIGN:
// any failure (table missing on a fresh deploy, no DB, no request/auth context for currentOrgId)
// MUST degrade to "no custom recognizers, plain thresholds" and let the base Presidio analyze run
// — it must NEVER bubble up and force the whole scan onto the regex floor. The deep layer is
// additive; a broken deep layer is still Presidio, not regex. We log the reason so it's diagnosable.
async function loadDeepConfig(): Promise<{
  recognizers: NormalizedRecognizer[];
  thresholds: ThresholdConfig;
}> {
  const { DEFAULT_THRESHOLDS } = await import('../presidio-recognizers');
  try {
    const [{ listRecognizers, getThresholds }, { currentOrgId }] = await Promise.all([
      import('../presidio-recognizers'),
      import('../tenancy'),
    ]);
    const orgId = await currentOrgId();
    const [recs, thresholds] = await Promise.all([listRecognizers(orgId), getThresholds(orgId)]);
    // The stored CustomRecognizer is a superset of NormalizedRecognizer (adds id/createdAt) — the
    // builder reads only the normalized fields, so the extra keys are harmless.
    return { recognizers: recs as unknown as NormalizedRecognizer[], thresholds };
  } catch (err) {
    console.warn('[pii] deep-config load failed, using plain analyze:', describeError(err));
    return { recognizers: [], thresholds: DEFAULT_THRESHOLDS };
  }
}

// Flatten an unknown thrown value into a diagnosable one-liner. fetch() failures hide the useful
// bit (ECONNREFUSED / ETIMEDOUT / ENOTFOUND) on `err.cause.code`, not `err.message` — surface it.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code ? `${err.message} (cause: ${String(code)})` : err.message;
  }
  return String(err);
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

    // Deep-config load is best-effort and CANNOT throw here (loadDeepConfig swallows + logs), so a
    // broken DB/auth context yields a PLAIN analyze — not a regex fallback. Build the request body
    // outside the network try so a config problem can't be mistaken for a Presidio outage.
    const { recognizers, thresholds } = await loadDeepConfig();
    const { buildAnalyzeRequest, applyThresholds } = await import('../presidio-recognizers');
    const body = buildAnalyzeRequest(text, recognizers, thresholds);

    let raw: PresidioEntity[];
    try {
      raw = await presidioAnalyze(url, body);
    } catch (err) {
      // The ONLY path that degrades to regex: Presidio itself was unreachable / errored / timed
      // out. Log the concrete reason (status + body, or the socket errno) so "why regex?" is
      // answerable from the logs instead of guessed at.
      console.warn('[pii] presidio analyze failed, degrading to regex floor:', describeError(err));
      return regexScan(text);
    }

    // Presidio answered 200. From here we ALWAYS return engine:'presidio' — an empty result set is
    // "Presidio found nothing", which is a real answer, not a failure. This is the line that keeps
    // a clean, no-PII string from being misreported as a regex scan.
    const found = applyThresholds(raw, thresholds);
    const entities = [...new Set(found.map((f) => f.entity_type))];
    // Prefer the real anonymizer service; else synthesize a redaction from the positions.
    const anonUrl = env.OFFGRID_PRESIDIO_ANONYMIZER_URL;
    const redacted =
      (anonUrl && found.length ? await presidioAnonymize(anonUrl, text, found) : null) ??
      (found.length ? redactSpans(text, found) : text);
    return { hits: entities.length > 0, entities, redacted, engine: 'presidio' };
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
