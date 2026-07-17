// One owner for the OpenTelemetry collector contract. OFFGRID_OTEL_URL is the canonical base URL;
// OFFGRID_OTLP_URL remains a backwards-compatible alias for deployments that used the emitter's old
// private name. Callers receive the resolved source so UI/API responses can say what is actually in
// use instead of presenting a configured-looking collector that was never contacted.

export type OtelConfigSource = 'OFFGRID_OTEL_URL' | 'OFFGRID_OTLP_URL' | 'none';

export interface OtelConfig {
  configured: boolean;
  baseUrl: string | null;
  tracesUrl: string | null;
  source: OtelConfigSource;
  legacyAlias: boolean;
}

type Env = Record<string, string | undefined>;

function cleanUrl(value: string | undefined): string | null {
  const url = value?.trim().replace(/\/+$/, '');
  return url || null;
}

export function resolveOtelConfig(env: Env = process.env): OtelConfig {
  const canonical = cleanUrl(env.OFFGRID_OTEL_URL);
  const legacy = cleanUrl(env.OFFGRID_OTLP_URL);
  const baseUrl = canonical ?? legacy;
  const source: OtelConfigSource = canonical
    ? 'OFFGRID_OTEL_URL'
    : legacy
      ? 'OFFGRID_OTLP_URL'
      : 'none';
  return {
    configured: baseUrl !== null,
    baseUrl,
    tracesUrl: baseUrl ? `${baseUrl}/v1/traces` : null,
    source,
    legacyAlias: source === 'OFFGRID_OTLP_URL',
  };
}

export type OtelReadiness =
  | { status: 'unconfigured'; configured: false; source: 'none' }
  | {
      status: 'ready';
      configured: true;
      source: Exclude<OtelConfigSource, 'none'>;
      httpStatus: number;
      ms: number;
    }
  | {
      status: 'down';
      configured: true;
      source: Exclude<OtelConfigSource, 'none'>;
      httpStatus: number | null;
      ms: number | null;
      error: string;
    };

/**
 * Exercise the real OTLP/HTTP ingest boundary with an empty, valid export envelope. A GET/port probe
 * is insufficient: it can be green while the receiver pipeline rejects OTLP payloads.
 */
export async function probeOtelReadiness(
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<OtelReadiness> {
  const config = resolveOtelConfig(env);
  if (!config.tracesUrl || config.source === 'none') {
    return { status: 'unconfigured', configured: false, source: 'none' };
  }
  const started = Date.now();
  try {
    const response = await fetcher(config.tracesUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] }),
      signal: AbortSignal.timeout(3000),
    });
    const ms = Date.now() - started;
    if (response.ok) {
      return {
        status: 'ready',
        configured: true,
        source: config.source,
        httpStatus: response.status,
        ms,
      };
    }
    const detail = await response.text().catch(() => '');
    return {
      status: 'down',
      configured: true,
      source: config.source,
      httpStatus: response.status,
      ms,
      error: `OTLP ingest ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
    };
  } catch (error) {
    return {
      status: 'down',
      configured: true,
      source: config.source,
      httpStatus: null,
      ms: null,
      error: error instanceof Error ? error.message : 'OTLP ingest unreachable',
    };
  }
}
