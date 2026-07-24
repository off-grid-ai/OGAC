import {
  applyThresholds,
  buildAnalyzeRequest,
  DEFAULT_THRESHOLDS,
  type NormalizedRecognizer,
  type ThresholdConfig,
} from '@/lib/presidio-recognizers';
import {
  type AnonymizerPolicy,
  bindEncryptKey,
  buildAnonymizeRequest,
  PRESIDIO_ENCRYPT_KEY_SECRET,
  policyUsesEncrypt,
} from '@/lib/presidio-anonymizers';
import { regexScan } from './pii-regex';
import type { PiiPort, PiiResult } from './types';

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export interface PresidioConfig {
  analyzerUrl: string | null;
  anonymizerUrl: string | null;
  timeoutMs: number;
}

export interface PresidioScanPolicy {
  recognizers?: NormalizedRecognizer[];
  thresholds?: ThresholdConfig;
  language?: string;
  /**
   * The org's per-entity OPERATOR policy (mask / redact / hash / encrypt / keep). ABSENT ⇒ the legacy
   * single-`replace` behaviour, so every existing caller is unchanged. PRESENT ⇒ the operator's
   * configured operators actually govern production redaction (they previously only applied on the
   * admin test surface, which is the gap this closes). Encrypt keys are already BOUND here (the
   * caller resolves them from the vault via bindEncryptKey) — this layer never touches secrets.
   */
  operators?: AnonymizerPolicy;
}

interface PresidioEntity {
  entity_type: string;
  start: number;
  end: number;
  score?: number;
}

function clean(value: string | undefined): string | null {
  return value?.trim().replace(/\/+$/, '') || null;
}

// Backwards compatibility for the on-prem pair: the historic OFFGRID_PRESIDIO_URL names the
// analyzer. Known compose/proxy analyzer ports have an adjacent anonymizer port. Any non-standard
// topology must set OFFGRID_PRESIDIO_ANONYMIZER_URL explicitly; we never guess a random endpoint.
export function resolvePresidioConfig(env: Env = process.env): PresidioConfig {
  const analyzerUrl = clean(env.OFFGRID_PRESIDIO_ANALYZER_URL ?? env.OFFGRID_PRESIDIO_URL);
  let anonymizerUrl = clean(env.OFFGRID_PRESIDIO_ANONYMIZER_URL);
  if (!anonymizerUrl && analyzerUrl) {
    try {
      const url = new URL(analyzerUrl);
      if (url.port === '5002') url.port = '5001';
      else if (url.port === '8938') url.port = '8939';
      else return { analyzerUrl, anonymizerUrl: null, timeoutMs: 8000 };
      anonymizerUrl = url.toString().replace(/\/$/, '');
    } catch {
      anonymizerUrl = null;
    }
  }
  return { analyzerUrl, anonymizerUrl, timeoutMs: 8000 };
}

function localRedaction(text: string, entities: PresidioEntity[]): string {
  let output = text;
  for (const entity of [...entities].sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, entity.start)}[${entity.entity_type}]${output.slice(entity.end)}`;
  }
  return output;
}

function anonymizers(
  entities: PresidioEntity[],
): Record<string, { type: 'replace'; new_value: string }> {
  return Object.fromEntries(
    [...new Set(entities.map((entity) => entity.entity_type))].map((entity) => [
      entity,
      { type: 'replace' as const, new_value: `[${entity}]` },
    ]),
  );
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  fetcher: Fetcher,
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

/** Real Presidio analyzer → anonymizer flow. Detection and replacement remain separate on purpose. */
export async function scanWithPresidio(
  text: string,
  config: PresidioConfig,
  policy: PresidioScanPolicy = {},
  fetcher: Fetcher = fetch,
): Promise<PiiResult> {
  if (!config.analyzerUrl) {
    return {
      ...regexScan(text),
      requestedEngine: 'presidio',
      status: 'fallback',
      reason: 'Presidio analyzer not configured; deterministic regex floor handled data redaction',
      scope: 'data-redaction',
    };
  }
  try {
    const raw = await postJson(
      `${config.analyzerUrl}/analyze`,
      buildAnalyzeRequest(
        text,
        policy.recognizers ?? [],
        policy.thresholds ?? DEFAULT_THRESHOLDS,
        policy.language ?? 'en',
      ),
      config.timeoutMs,
      fetcher,
    );
    const analyzed = Array.isArray(raw) ? (raw as PresidioEntity[]) : [];
    const entities = applyThresholds(analyzed, policy.thresholds ?? DEFAULT_THRESHOLDS);
    if (entities.length === 0) {
      return {
        hits: false,
        entities: [],
        redacted: text,
        engine: 'presidio',
        requestedEngine: 'presidio',
        configured: true,
        status: 'applied',
        scope: 'data-redaction',
      };
    }

    const names = [...new Set(entities.map((entity) => entity.entity_type))];
    if (!config.anonymizerUrl) {
      return {
        hits: true,
        entities: names,
        redacted: localRedaction(text, entities),
        engine: 'presidio+local-redaction',
        requestedEngine: 'presidio',
        configured: true,
        status: 'fallback',
        reason:
          'Presidio analyzer handled detection; anonymizer URL is not configured, so local span replacement was used',
        scope: 'data-redaction',
      };
    }

    try {
      // The org's OPERATOR policy governs production redaction when present (reusing the SAME pure
      // request builder the admin test surface uses — one authority, no second shaping rule); absent,
      // the legacy single-`replace` body is sent verbatim.
      const body = policy.operators
        ? buildAnonymizeRequest(text, entities, policy.operators)
        : { text, analyzer_results: entities, anonymizers: anonymizers(entities) };
      const anonymized = (await postJson(
        `${config.anonymizerUrl}/anonymize`,
        body,
        config.timeoutMs,
        fetcher,
      )) as { text?: unknown };
      return {
        hits: true,
        entities: names,
        redacted:
          typeof anonymized.text === 'string' ? anonymized.text : localRedaction(text, entities),
        engine: 'presidio',
        requestedEngine: 'presidio',
        configured: true,
        status: typeof anonymized.text === 'string' ? 'applied' : 'fallback',
        ...(typeof anonymized.text === 'string'
          ? {}
          : { reason: 'Presidio anonymizer returned no text; local span replacement was used' }),
        scope: 'data-redaction',
      };
    } catch (error) {
      return {
        hits: true,
        entities: names,
        redacted: localRedaction(text, entities),
        engine: 'presidio+local-redaction',
        requestedEngine: 'presidio',
        configured: true,
        status: 'fallback',
        reason: `Presidio anonymizer unavailable; local span replacement was used (${error instanceof Error ? error.message : String(error)})`,
        scope: 'data-redaction',
      };
    }
  } catch (error) {
    return {
      ...regexScan(text),
      requestedEngine: 'presidio',
      configured: true,
      status: 'fallback',
      reason: `Presidio analyzer unavailable; deterministic regex floor handled data redaction (${error instanceof Error ? error.message : String(error)})`,
      scope: 'data-redaction',
    };
  }
}

/**
 * Resolve the org's AES key for the `encrypt` operator from the SECRETS STORE (OpenBao), with an env
 * bootstrap fallback. Never throws and never logs the material — an unresolved key makes
 * bindEncryptKey downgrade encryption to masking rather than fail open.
 */
async function resolveEncryptKey(): Promise<string | null> {
  try {
    const { openBaoSecrets } = await import('@/lib/adapters/secrets');
    const vaulted = await openBaoSecrets.get(PRESIDIO_ENCRYPT_KEY_SECRET);
    if (typeof vaulted === 'string' && vaulted.trim()) return vaulted.trim();
  } catch {
    /* vault unreachable — fall through to the env bootstrap */
  }
  return process.env.OFFGRID_PRESIDIO_ENCRYPT_KEY?.trim() || null;
}

async function loadPolicy(orgId?: string): Promise<PresidioScanPolicy> {
  try {
    const { getThresholds, listRecognizers } = await import('@/lib/presidio-recognizers');
    const { getAnonymizerPolicy } = await import('@/lib/presidio-anonymizer-policy-store');
    const resolvedOrg = orgId?.trim() || 'default';
    const [recognizers, thresholds, stored] = await Promise.all([
      listRecognizers(resolvedOrg),
      getThresholds(resolvedOrg),
      getAnonymizerPolicy(resolvedOrg),
    ]);
    // Bind the vaulted key ONLY when the policy actually encrypts, so a non-encrypting org never
    // touches the secrets store. An unresolvable key downgrades to masking (fail safe, reported).
    const operators = policyUsesEncrypt(stored)
      ? bindEncryptKey(stored, await resolveEncryptKey()).policy
      : stored;
    return { recognizers, thresholds, operators };
  } catch {
    // The default India recognizers are folded in by buildAnalyzeRequest. A policy-store failure must
    // not bypass redaction; it only loses the org overrides for this call (legacy replace applies).
    return {};
  }
}

export const presidioDataPii: PiiPort = {
  meta: {
    id: 'presidio',
    capability: 'guardrails',
    vendor: 'Microsoft Presidio',
    license: 'MIT',
    render: 'headless',
    embedUrl: process.env.OFFGRID_PRESIDIO_ANALYZER_URL ?? process.env.OFFGRID_PRESIDIO_URL,
    description:
      'Data-movement PII analyzer/anonymizer only. Content and prompt scanning remains exclusively owned by LLM Guard.',
  },
  async scan(text, orgId) {
    return scanWithPresidio(text, resolvePresidioConfig(), await loadPolicy(orgId));
  },
  async health() {
    const config = resolvePresidioConfig();
    if (!config.analyzerUrl) return false;
    try {
      const response = await fetch(`${config.analyzerUrl}/health`, {
        signal: AbortSignal.timeout(2500),
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
