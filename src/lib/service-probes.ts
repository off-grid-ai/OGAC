import { Pool } from 'pg';
import { probeOtelReadiness } from './otel-config';
import type { ServiceEntry, ServiceHealth } from './services-directory';

export type ServiceProbeAdapter = (entry: ServiceEntry) => Promise<ServiceHealth>;

async function probePostgres(entry: ServiceEntry): Promise<ServiceHealth> {
  const started = Date.now();
  const pool = new Pool({ connectionString: entry.url, connectionTimeoutMillis: 2500, max: 1 });
  try {
    await pool.query('select 1');
    return {
      id: entry.id,
      status: 'up',
      httpStatus: null,
      ms: Date.now() - started,
      detail: 'SQL query accepted',
    };
  } catch (error) {
    return {
      id: entry.id,
      status: 'down',
      httpStatus: null,
      ms: null,
      error: error instanceof Error ? error.message : 'Postgres unreachable',
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function probeOtel(entry: ServiceEntry): Promise<ServiceHealth> {
  const result = await probeOtelReadiness();
  if (result.status === 'unconfigured') {
    return {
      id: entry.id,
      status: 'optional',
      httpStatus: null,
      ms: null,
      detail: 'OTLP ingest not configured (optional)',
    };
  }
  if (result.status === 'ready') {
    return {
      id: entry.id,
      status: 'up',
      httpStatus: result.httpStatus,
      ms: result.ms,
      detail: `OTLP ingest accepted via ${result.source}`,
    };
  }
  return {
    id: entry.id,
    status: 'down',
    httpStatus: result.httpStatus,
    ms: result.ms,
    error: result.error,
    detail: `configured via ${result.source}`,
  };
}

const PROBES: Readonly<Record<string, ServiceProbeAdapter>> = {
  postgres: probePostgres,
  'otel-collector': probeOtel,
};

export function serviceProbeAdapter(id: string): ServiceProbeAdapter | undefined {
  return PROBES[id];
}
