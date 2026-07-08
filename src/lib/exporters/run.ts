// Thin I/O runner for exporters — the ONLY place test()/export() touch the network + read the spine.
// Resolves a stored target (incl. its secret) via store.ts, pulls the right spine slice for the
// target's kind from the EXISTING reader libs (audit search, finops), then calls the pure exporter
// and persists the HONEST outcome. No payload logic lives here — that's all in the exporters.

import type { AuditEvent } from '@/lib/audit-event';
import { computeFinOps } from '@/lib/finops';
import { searchAudit, type AuditHit } from '@/lib/siem';
import { finOpsToSamples } from './registry';
import { exporterFor } from './registry';
import { recordExportStatus, resolveTarget } from './store';
import type { ExportResult, FetchLike, ProbeResult } from './types';

// Wrap global fetch into the minimal FetchLike the exporters expect (so they stay easily faked).
const realFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

// A stored audit hit → the canonical AuditEvent the Splunk exporter ships. The hit already carries
// the canonical fields (actor/action/org/outcome/model/costUsd); we shape them back into the
// AuditEvent contract without re-deriving anything.
export function hitToAuditEvent(h: AuditHit): AuditEvent {
  const ev: AuditEvent = {
    ts: h.ts,
    actor: h.actor ?? {
      type: h.actorType ?? 'user',
      id: h.actorId ?? 'unknown',
      label: h.actorId ?? 'unknown',
    },
    org: h.org ?? 'default',
    action: h.action ?? 'chat.send',
    outcome: (h.outcome as AuditEvent['outcome']) ?? 'ok',
  };
  if (h.project) ev.project = h.project;
  if (h.resource) ev.resource = h.resource;
  if (h.model) ev.model = h.model;
  if (typeof h.promptTokens === 'number' && typeof h.completionTokens === 'number') {
    ev.tokens = {
      prompt: h.promptTokens,
      completion: h.completionTokens,
      total: h.tokens ?? h.promptTokens + h.completionTokens,
    };
  }
  if (typeof h.costUsd === 'number') ev.costUsd = h.costUsd;
  if (h.runId) ev.runId = h.runId;
  if (h.ip) ev.ip = h.ip;
  return ev;
}

// Test a stored target's connection for real. Resolves it (incl. secret from the vault), calls the
// exporter's real test(), and persists the honest last-status. Returns the probe result.
export async function testTarget(id: string, orgId: string): Promise<ProbeResult> {
  const resolved = await resolveTarget(id, orgId);
  if (!resolved) return { ok: false, detail: 'Export target not found.' };
  const exporter = exporterFor(resolved.kind);
  const result = await exporter.test(resolved, realFetch);
  await recordExportStatus(id, orgId, result.ok ? 'ok' : 'fail', result.detail);
  return result;
}

// The default export batch size for the audit slice — bounded so a manual "export now" doesn't drag
// the whole index.
const AUDIT_BATCH = 500;

// Run an export NOW for a stored target: pull the spine slice for its kind, ship it, persist status.
export async function runExport(id: string, orgId: string): Promise<ExportResult> {
  const resolved = await resolveTarget(id, orgId);
  if (!resolved) return { ok: false, count: 0, detail: 'Export target not found.' };
  const exporter = exporterFor(resolved.kind);

  let result: ExportResult;
  if (resolved.kind === 'audit') {
    const search = await searchAudit({ size: AUDIT_BATCH, offset: 0 });
    if (!search.configured) {
      result = { ok: false, count: 0, detail: 'Audit search backend not configured — nothing to export.' };
    } else {
      const events = search.hits.map(hitToAuditEvent);
      result = await exporter.export(resolved, events, realFetch);
    }
  } else if (resolved.kind === 'metrics') {
    const finops = await computeFinOps();
    const samples = finOpsToSamples(finops);
    result = await exporter.export(resolved, samples, realFetch);
  } else {
    // lineage: events are emitted continuously to the configured OpenLineage endpoint by the spine.
    // A manual "run now" verifies the endpoint accepts a spec-compliant event (a probe run), which is
    // exactly what test() does — so we surface that rather than replaying historical lineage.
    result = await exporter.export(resolved, [], realFetch);
  }

  await recordExportStatus(id, orgId, result.ok ? 'ok' : 'fail', result.detail);
  return result;
}
