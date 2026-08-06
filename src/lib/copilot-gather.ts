// ─── OPS COPILOT context-gather — the READ-ONLY I/O half ──────────────────────────────────────────
//
// M5. Assembles a CopilotContext by calling the EXISTING reader libs (audit, finops, drift, evals)
// — read-only, never writing anything. Each read is best-effort: a source that's unconfigured or
// erroring contributes nothing, so the pure prompt builder can honestly say "no data" for it. The
// derived anomaly scans come from the pure detector run over finops time-series.
//
// This file is deliberately thin: no reasoning here (that's copilot-context.ts, pure). It only wires
// real readers → the context shape. It is unit-testable by injecting fake readers via `gatherWith`.

import { detectAnomalies, type SeriesPoint } from './anomaly';
import { readAuditPage } from './audit-log-reader';
import type { AuditRow } from './audit-log-view';
import type { CopilotContext } from './copilot-context';
import { readDriftView, type DriftView } from './drift-view';
import { readEvalsView, type EvalsView } from './evals-view';
import { computeFinOps, type FinOps } from './finops';
import { currentOrgId } from './tenancy';

/** Injectable readers so the gather is unit-testable with fakes (no DB/gateway). */
export interface CopilotReaders {
  audit: () => Promise<{ rows: AuditRow[]; configured: boolean }>;
  finops: () => Promise<FinOps | null>;
  drift: () => Promise<DriftView | null>;
  evals: () => Promise<EvalsView | null>;
  /** Which of these run ids this org can open. Optional: absent means no run links are produced. */
  knownRunIds?: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
}

const RECENT_AUDIT = 200;

// The real, production readers — each wrapped so a failure degrades to "absent", never throws.
const realReaders: CopilotReaders = {
  knownRunIds: async (ids) => {
    const { existingRunIds } = await import('@/lib/run-existence');
    return existingRunIds(await currentOrgId(), ids);
  },
  audit: async () => {
    try {
      // Scoped to the caller's org. This read feeds the copilot's PROMPT, so an unscoped one would
      // have let the assistant summarise another tenant's audit trail back to this tenant in prose —
      // the same leak as the audit view, minus the screenshot that would have revealed it. Found by
      // the typechecker once `org` became required rather than by looking, which is the argument for
      // making a tenant boundary a required parameter instead of a convention.
      const page = await readAuditPage({ size: RECENT_AUDIT, page: 1 }, await currentOrgId());
      return { rows: page.rows, configured: page.configured };
    } catch {
      return { rows: [], configured: false };
    }
  },
  finops: async () => {
    try {
      return await computeFinOps(null, await currentOrgId());
    } catch {
      return null;
    }
  },
  drift: async () => {
    try {
      return (await readDriftView()).data;
    } catch {
      return null;
    }
  },
  evals: async () => {
    try {
      return await readEvalsView();
    } catch {
      return null;
    }
  },
};

/**
 * Derive the spine time-series → anomaly scans (PURE detector over gathered data). Cost/day from
 * finops.daily; per-model request volume optionally. Only series with enough history produce a scan.
 * Exported so it can be unit-tested independently.
 */
export function deriveAnomalies(finops: FinOps | null): { metric: string; scan: ReturnType<typeof detectAnomalies> }[] {
  if (!finops) return [];
  const out: { metric: string; scan: ReturnType<typeof detectAnomalies> }[] = [];

  const daily: SeriesPoint[] = finops.daily.map((d) => ({ label: d.day, value: d.costUsd }));
  if (daily.length >= 4) {
    // Use a shorter window on short series so we can still flag a spike in a week of data.
    const window = Math.min(7, Math.max(2, daily.length - 2));
    const scan = detectAnomalies(daily, { window, only: 'spike' });
    if (scan.anomalies.length) out.push({ metric: 'daily cost', scan });
  }

  return out;
}

/** Gather with injected readers (test seam). Pure orchestration over the injected reads. */
export async function gatherWith(question: string, readers: CopilotReaders): Promise<CopilotContext> {
  const [audit, finops, drift, evals] = await Promise.all([
    readers.audit(),
    readers.finops(),
    readers.drift(),
    readers.evals(),
  ]);
  // Which of the cited runs can actually be opened. One query, over ids we already hold; injected
  // like every other reader so the orchestration stays testable without a database.
  const runIds = (audit?.rows ?? []).map((r) => r.runId).filter((id): id is string => Boolean(id));
  const knownRunIds = readers.knownRunIds ? await readers.knownRunIds(runIds) : undefined;
  return {
    question,
    audit,
    finops,
    drift,
    evals,
    knownRunIds,
    anomalies: deriveAnomalies(finops),
  };
}

/** Gather real spine context for a copilot question. Read-only; never writes. */
export function gatherCopilotContext(question: string): Promise<CopilotContext> {
  return gatherWith(question, realReaders);
}
