import {
  buildCheckpoint,
  failureVerdict,
  parseCheckpointResult,
  type CheckpointVerdict,
  type Expectation,
  type RawCheckpointResult,
  type Row,
} from '../data-quality-model';
import type { AdapterMeta } from './types';

// ─── Data-quality adapter (Great Expectations sidecar) ──────────────────────────────────────────
//
// The third sidecar-backed capability adapter, mirroring the evidently drift adapter
// (adapters/drift.ts) and the ragas evals adapter: the console stays Node-only while a thin Python
// sidecar (deploy/sidecars/great-expectations/app.py) runs the REAL Great Expectations checkpoint.
//
// SOLID: this file is I/O ONLY — read env, fetch with a timeout, delegate build+parse to the pure
// data-quality-model. Graceful degradation is the contract: health() returns false when the sidecar
// is unset/unreachable, and runCheckpoint returns a well-formed FAILURE verdict (never throws) so a
// data-quality gate that can't reach the engine fails closed with a legible reason instead of
// crashing the caller.
//
// Env: OFFGRID_DATAQUALITY_URL (default http://127.0.0.1:8944 — the on-prem sidecar port mapping).

const DEFAULT_URL = 'http://127.0.0.1:8944';
const CHECKPOINT_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 2500;

function baseUrl(): string {
  return (process.env.OFFGRID_DATAQUALITY_URL || DEFAULT_URL).replace(/\/$/, '');
}

// Flatten a thrown value into a diagnosable one-liner. fetch() hides the useful errno
// (ECONNREFUSED / ETIMEDOUT / ENOTFOUND) on err.cause.code, not err.message — surface it.
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code ? `${err.message} (${String(code)})` : err.message;
  }
  return String(err);
}

export interface DataQualityHealth {
  healthy: boolean;
  engine?: string; // the sidecar's self-reported engine label ("great-expectations" | "native")
  url: string;
}

export interface DataQualityPort {
  meta: AdapterMeta;
  health(): Promise<DataQualityHealth>;
  runCheckpoint(
    suite: string,
    rows: unknown,
    expectations: unknown,
  ): Promise<CheckpointVerdict>;
}

export const geDataQuality: DataQualityPort = {
  meta: {
    id: 'great-expectations',
    // 'mdm' is the console's master-data / data-governance capability slot; data-quality checks
    // are the enforcement arm of it. (No dedicated 'data-quality' capability exists in the shared
    // enum, and this adapter must not edit shared types.)
    capability: 'mdm',
    vendor: 'Great Expectations',
    license: 'Apache-2.0',
    render: 'headless',
    embedUrl: process.env.OFFGRID_DATAQUALITY_URL,
    description:
      'Expectation-suite checkpoints (not-null / in-range / in-set / unique / column-exists) over a dataset window. Runs the bundled Great Expectations sidecar; fails closed with a legible verdict if unreachable.',
  },

  async health(): Promise<DataQualityHealth> {
    const url = baseUrl();
    try {
      const res = await fetch(`${url}/`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) return { healthy: false, url };
      const body = (await res.json().catch(() => ({}))) as { engine?: string; status?: string };
      return { healthy: body.status === 'ok', engine: body.engine, url };
    } catch {
      return { healthy: false, url };
    }
  },

  async runCheckpoint(suite, rows, expectations): Promise<CheckpointVerdict> {
    const url = baseUrl();
    const checkpoint = buildCheckpoint(rows, expectations);
    // The pure builder is the source of truth for the wire body; keep the typed expectation list
    // around so a failure verdict can name every rule it couldn't evaluate.
    const exps: Expectation[] = checkpoint.expectations;
    const safeSuite = encodeURIComponent(suite || 'default');
    try {
      const res = await fetch(`${url}/checkpoint/${safeSuite}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: checkpoint.rows as Row[],
          expectations: exps,
        }),
        signal: AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return failureVerdict(exps, `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }
      const raw = (await res.json()) as RawCheckpointResult;
      return parseCheckpointResult(raw);
    } catch (err) {
      return failureVerdict(exps, describeError(err));
    }
  },
};

export const DATA_QUALITY_PORTS: DataQualityPort[] = [geDataQuality];
