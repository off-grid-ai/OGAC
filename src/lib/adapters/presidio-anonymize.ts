// Adapter: run the DEPLOYED Presidio analyzer → anonymizer flow honoring a per-entity OPERATOR
// POLICY (mask / redact / hash / encrypt / replace / keep) — NOT the hard-coded single `replace`
// that the proven scan path (adapters/presidio.ts) uses. That proven path is untouched; this is a
// NEW, separate flow for the masking-policy surface.
//
// SOLID / DRY: every DECISION is pure and lives elsewhere —
//   • detection request shaping + threshold filtering  → presidio-recognizers.ts (reused as-is)
//   • operator policy → /anonymize body + response norm → presidio-anonymizers.ts (reused as-is)
//   • Presidio URL/env resolution                       → adapters/presidio.ts resolvePresidioConfig
// This file is ONLY the I/O orchestration (two HTTP calls) + honest status assembly. The loaders +
// fetcher are injectable so the orchestration is unit-tested with a fake at the network boundary
// (no mocks of our own code) while the route path uses the real DB + real fetch.
import {
  applyThresholds,
  buildAnalyzeRequest,
  DEFAULT_THRESHOLDS,
  getThresholds,
  listRecognizers,
  type NormalizedRecognizer,
  type ThresholdConfig,
} from '@/lib/presidio-recognizers';
import {
  type AnonymizeItem,
  type AnonymizerPolicy,
  buildAnonymizeRequest,
  DEFAULT_ANONYMIZER_POLICY,
  normalizeAnonymizeResponse,
  type PresidioAnalyzerResult,
} from '@/lib/presidio-anonymizers';
import { getAnonymizerPolicy } from '@/lib/presidio-anonymizer-policy-store';
import { type PresidioConfig, resolvePresidioConfig } from './presidio';

export interface PolicyAnonymizeResult {
  /** false ⇒ no Presidio URL configured; the surface honestly says "engine not configured". */
  configured: boolean;
  status: 'applied' | 'fallback' | 'unconfigured' | 'down';
  engine: string;
  original: string;
  /** The masked/anonymized text — the terminal artifact. Equals `original` when nothing applied. */
  text: string;
  entities: string[];
  items: AnonymizeItem[];
  reason?: string;
}

export interface AnonymizeDeps {
  fetcher?: typeof fetch;
  config?: PresidioConfig;
  loadRecognizers?: (orgId: string) => Promise<NormalizedRecognizer[]>;
  loadThresholds?: (orgId: string) => Promise<ThresholdConfig>;
  loadPolicy?: (orgId: string) => Promise<AnonymizerPolicy>;
  language?: string;
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Presidio ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }
  return response.json();
}

// Load the org's detection config (recognizers + thresholds) + operator policy. Best-effort: a
// policy-store failure must not bypass masking — it only loses the org overrides for this call.
async function loadOrgConfig(
  orgId: string,
  deps: AnonymizeDeps,
): Promise<{ recognizers: NormalizedRecognizer[]; thresholds: ThresholdConfig; policy: AnonymizerPolicy }> {
  const resolved = orgId.trim() || 'default';
  const loadRecognizers = deps.loadRecognizers ?? listRecognizers;
  const loadThresholds = deps.loadThresholds ?? getThresholds;
  const loadPolicy = deps.loadPolicy ?? getAnonymizerPolicy;
  try {
    const [recognizers, thresholds, policy] = await Promise.all([
      loadRecognizers(resolved),
      loadThresholds(resolved),
      loadPolicy(resolved),
    ]);
    return { recognizers, thresholds, policy };
  } catch {
    return { recognizers: [], thresholds: DEFAULT_THRESHOLDS, policy: DEFAULT_ANONYMIZER_POLICY };
  }
}

// Detect entities via the analyzer, then anonymize them with the org's operator policy. Returns an
// honest status: 'applied' when the engine masked the text; 'fallback' when the anonymizer errored/
// returned nothing; 'unconfigured' when no analyzer URL is set; 'down' when the analyzer is
// unreachable. Never throws — a masking surface must degrade honestly, not crash.
export async function anonymizeWithPolicy(
  text: string,
  orgId = 'default',
  deps: AnonymizeDeps = {},
): Promise<PolicyAnonymizeResult> {
  const config = deps.config ?? resolvePresidioConfig();
  const fetcher = deps.fetcher ?? fetch;
  const language = deps.language ?? 'en';

  if (!config.analyzerUrl || !config.anonymizerUrl) {
    return {
      configured: false,
      status: 'unconfigured',
      engine: 'presidio',
      original: text,
      text,
      entities: [],
      items: [],
      reason: 'Presidio analyzer/anonymizer URL is not configured; no masking was applied',
    };
  }

  const { recognizers, thresholds, policy } = await loadOrgConfig(orgId, deps);

  let entities: PresidioAnalyzerResult[];
  try {
    const raw = await postJson(
      `${config.analyzerUrl}/analyze`,
      buildAnalyzeRequest(text, recognizers, thresholds, language),
      config.timeoutMs,
      fetcher,
    );
    const analyzed = Array.isArray(raw) ? (raw as PresidioAnalyzerResult[]) : [];
    entities = applyThresholds(analyzed, thresholds);
  } catch (error) {
    return {
      configured: true,
      status: 'down',
      engine: 'presidio',
      original: text,
      text,
      entities: [],
      items: [],
      reason: `Presidio analyzer unavailable; no masking was applied (${errMsg(error)})`,
    };
  }

  const names = [...new Set(entities.map((e) => e.entity_type))];
  if (entities.length === 0) {
    return {
      configured: true,
      status: 'applied',
      engine: 'presidio',
      original: text,
      text,
      entities: [],
      items: [],
    };
  }

  try {
    const raw = await postJson(
      `${config.anonymizerUrl}/anonymize`,
      buildAnonymizeRequest(text, entities, policy),
      config.timeoutMs,
      fetcher,
    );
    const outcome = normalizeAnonymizeResponse(raw, text);
    const applied = outcome.items.length > 0 || outcome.text !== text;
    return {
      configured: true,
      status: applied ? 'applied' : 'fallback',
      engine: 'presidio',
      original: text,
      text: outcome.text,
      entities: names,
      items: outcome.items,
      ...(applied ? {} : { reason: 'Presidio anonymizer returned no changes' }),
    };
  } catch (error) {
    return {
      configured: true,
      status: 'fallback',
      engine: 'presidio',
      original: text,
      text,
      entities: names,
      items: [],
      reason: `Presidio anonymizer unavailable; text left unmasked (${errMsg(error)})`,
    };
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
