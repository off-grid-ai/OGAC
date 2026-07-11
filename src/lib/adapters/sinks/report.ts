// ─── Report output sink (Builder Epic Phase 4B, §3.3) ────────────────────────────────────────────
//
// The `output:report` sink for the multi-step executor. An app-run whose final output step is a
// report renders the run into a signed, auditable artifact — the same substrate the regulator
// reports already use: a Markdown body (from the run view + the pure single-run rollup) → PDF via
// pdf.ts → a detached, ed25519-signed provenance manifest via provenance.ts. Nothing here recomputes
// a metric or reaches into the DB: it consumes an already-shaped AppRunView (from 4A's reader) and
// the pure RunSummary (from app-reports.ts). Keeping it a thin renderer means the executor calls
// `renderAppRunReport(view)` and gets back bytes + a manifest it can persist or stream.
//
// The download ROUTE (api/v1/admin/app-runs/[id]/report) is the operator-facing entry: admin-gated,
// reads the run, calls this, and streams the PDF/Markdown with the provenance headers.

import { type RunSummary, singleRunSummary } from '@/lib/app-reports';
import type { AppRunView } from '@/lib/app-runs-view';
import { statusLabel } from '@/lib/app-runs-view';
import { markdownToPdf } from '@/lib/pdf';
import { type ProvenanceManifest, buildManifest } from '@/lib/provenance';

// ─── AppRunReport — the rendered artifact + its signed manifest ───────────────────────────────────
export interface AppRunReport {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  manifest: ProvenanceManifest;
  markdown: string; // the source body, kept for a ?format=md download without re-rendering
}

// ─── buildReportMarkdown — the report body (pure over the view + summary) ─────────────────────────
// Exported so the route can serve a Markdown download and so it is unit-checkable independently of
// the PDF/crypto layers. It leans on the pure `singleRunSummary` for the numbers and the shared
// `statusLabel` so the wording matches the live screens.
export function buildReportMarkdown(run: AppRunView, summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`# App Run Report — ${run.id}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- App: ${run.appId}`);
  lines.push(`- Status: ${statusLabel(run.status)}`);
  lines.push(`- Steps: ${summary.stepsDone}/${summary.stepCount} completed, ${summary.stepsErrored} errored`);
  lines.push(
    `- Human decisions: ${summary.humanDecisions.approvals} approved, ${summary.humanDecisions.rejections} rejected`,
  );
  lines.push(`- Duration: ${fmtDuration(summary.durationMs)}`);
  lines.push(`- Tokens: ${summary.tokens.toLocaleString()}`);
  lines.push(`- Cost: $${summary.costUsd.toFixed(2)}`);
  lines.push(`- Started: ${run.startedAt ?? '—'}`);
  lines.push(`- Finished: ${run.finishedAt ?? '—'}`);
  lines.push('');

  lines.push('## Inputs');
  const inputKeys = Object.keys(run.input ?? {});
  if (inputKeys.length === 0) {
    lines.push('- (none)');
  } else {
    for (const k of inputKeys) {
      lines.push(`- ${k}: ${stringifyValue((run.input as Record<string, unknown>)[k])}`);
    }
  }
  lines.push('');

  lines.push('## Steps');
  if ((run.steps ?? []).length === 0) {
    lines.push('- (no steps recorded)');
  } else {
    for (const [i, step] of (run.steps ?? []).entries()) {
      lines.push(`### ${i + 1}. ${step.label || step.id} (${step.kind})`);
      lines.push(`- Status: ${statusLabel(step.status)}`);
      if (step.outcome) lines.push(`- Outcome: ${step.outcome}`);
      if (step.detail) lines.push(`- Detail: ${step.detail}`);
      if (step.refs && step.refs.length) lines.push(`- Sources: ${step.refs.join(', ')}`);
      if (step.childRunId) lines.push(`- Child run: ${step.childRunId}`);
      lines.push('');
    }
  }

  lines.push('## Final outcome');
  lines.push(run.outcome ? run.outcome : '(no final outcome recorded)');
  lines.push('');

  lines.push('## Provenance');
  if (run.provenance) {
    lines.push(`- Algorithm: ${run.provenance.algorithm}`);
    lines.push(`- Signed at: ${run.provenance.signedAt}`);
    lines.push(`- Signature: ${run.provenance.signature}`);
  } else {
    lines.push('- (run not signed)');
  }

  return lines.join('\n');
}

// ─── renderAppRunReport — the sink entry point ────────────────────────────────────────────────────
// Renders a run to a signed report. `format` picks PDF (default — the auditable artifact) or the raw
// Markdown. The returned manifest is over the exact bytes served, so a verifier can recompute the
// hash and check the ed25519 signature with the published public key (offline, no shared secret).
export async function renderAppRunReport(
  run: AppRunView,
  format: 'pdf' | 'md' = 'pdf',
): Promise<AppRunReport> {
  const summary = singleRunSummary(run);
  const markdown = buildReportMarkdown(run, summary);
  const base = `offgrid-app-run-${run.id}`;
  const generatedAt = new Date().toISOString();

  let bytes: Uint8Array;
  let filename: string;
  let contentType: string;
  if (format === 'md') {
    bytes = new TextEncoder().encode(markdown);
    filename = `${base}.md`;
    contentType = 'text/markdown';
  } else {
    bytes = await markdownToPdf(base, markdown);
    filename = `${base}.pdf`;
    contentType = 'application/pdf';
  }

  const manifest = buildManifest(bytes, filename, contentType, generatedAt);
  return { filename, contentType, bytes, manifest, markdown };
}

// ─── helpers ──────────────────────────────────────────────────────────────────────────────────────
function fmtDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
