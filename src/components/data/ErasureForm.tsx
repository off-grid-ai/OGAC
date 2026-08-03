'use client';

import { MagnifyingGlass, ShieldSlash as ShieldX, CheckCircle, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { explainResponse } from '@/lib/api-failure';

interface Preview {
  subject: string;
  recognisedAs: string[];
  stores: { store: string; table: string }[];
  deferred: string[];
  embedded: { type: string; masked: string; chunks: number; runs: number; summary: string }[];
  found: boolean;
}

interface Report {
  status?: string;
  erasedRows?: number;
  results?: { store: string; deleted: number }[];
  deferred?: string[];
  embedded?: { type: string; chunksDeleted: number; runsRedacted: number; remaining: number }[];
  proven?: boolean;
  embeddedRemaining?: number;
}

interface Propagated {
  target: string;
  ok?: boolean;
  reason?: string;
}

// ─── Right to erasure — FIND, then ERASE, then PROVE ───────────────────────────────────────────────
//
// This was a text box and an "Erase subject" button that deleted irreversibly on first click and
// reported a row count in a toast. Two things wrong with that for the person who actually uses it:
//
//  1. A DPO is answering a legal request. They must be able to say WHAT was found and WHERE before
//     anything is destroyed — and afterwards, produce evidence that nothing remains. A toast is not
//     evidence.
//  2. It only ever cleared ROWS KEYED BY THE SUBJECT. The copies inside indexed documents and run
//     records — where the personal data actually is — were untouched and invisible.
//
// So: find first (touches nothing), review what was found, then erase, then show the re-queried proof.
export function ErasureForm() {
  const [subject, setSubject] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [propagation, setPropagation] = useState<Propagated[] | null>(null);
  const [busy, setBusy] = useState<'find' | 'erase' | null>(null);

  async function find() {
    if (!subject.trim()) return;
    setBusy('find');
    setReport(null);
    const res = await fetch('/api/v1/admin/erasure/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject }),
    });
    setBusy(null);
    if (!res.ok) {
      const f = await explainResponse(res, 'search for this person');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    setPreview(await res.json());
  }

  async function erase() {
    setBusy('erase');
    // The DURABLE path: it files an auditable erasure request and propagates to the external planes
    // (vector index, lake, device replicas), as well as running the console-plane deletes. The other
    // route does the deletes without filing anything, which is not what answering a legal request is.
    const res = await fetch('/api/v1/admin/erasure-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject }),
    });
    setBusy(null);
    if (!res.ok) {
      const f = await explainResponse(res, 'erase this person');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    const data = (await res.json()) as {
      report?: Report;
      propagation?: { propagated?: Propagated[]; deferred?: Propagated[] };
    };
    setReport(data.report ?? null);
    setPropagation([
      ...(data.propagation?.propagated ?? []).map((p) => ({ ...p, ok: true })),
      ...(data.propagation?.deferred ?? []).map((p) => ({ ...p, ok: false })),
    ]);
    setPreview(null);
    const proven = data.report?.proven;
    toast[proven ? 'success' : 'warning'](
      proven ? 'Erased — no copies remain' : 'Erased in part — see what is left',
    );
  }

  const embeddedTotal = (preview?.embedded ?? []).reduce((n, e) => n + e.chunks + e.runs, 0);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={subject}
          placeholder="Email, PAN, mobile or reference — e.g. EXP-2025-00001"
          onChange={(e) => {
            setSubject(e.target.value);
            setPreview(null);
            setReport(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && find()}
        />
        <Button variant="outline" onClick={find} disabled={busy !== null || !subject.trim()} className="shrink-0 gap-1.5">
          <MagnifyingGlass className="size-4" />
          {busy === 'find' ? 'Searching…' : 'Find every copy'}
        </Button>
      </div>

      {/* WHAT WAS FOUND — before anything is destroyed. */}
      {preview ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          {!preview.found ? (
            // Nothing found is a real answer and must not look like a failed search.
            <p className="text-xs text-muted-foreground">
              No record of <span className="font-mono">{preview.subject}</span> in this tenant. Nothing
              to erase — this is an answer, not a failure.
            </p>
          ) : (
            <>
              <p className="text-xs">
                Searched as{' '}
                <span className="font-medium">{preview.recognisedAs.join(', ').toLowerCase()}</span>
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  · <span className="font-medium text-foreground">{preview.stores.length}</span> record
                  store{preview.stores.length === 1 ? '' : 's'} hold rows keyed to this person
                </li>
                {preview.embedded.map((e) => (
                  <li key={e.type}>
                    ·{' '}
                    <span className="font-medium text-foreground">
                      {e.chunks} indexed chunk{e.chunks === 1 ? '' : 's'} and {e.runs} run record
                      {e.runs === 1 ? '' : 's'}
                    </span>{' '}
                    mention {e.masked}
                  </li>
                ))}
                {!preview.embedded.length ? (
                  <li>· no embedded copies found in indexed documents or run records</li>
                ) : null}
                {preview.deferred.length ? (
                  <li className="text-amber-600 dark:text-amber-500">
                    · {preview.deferred.length} store{preview.deferred.length === 1 ? '' : 's'} cannot be
                    reached from here: {preview.deferred.join(', ')}
                  </li>
                ) : null}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Record rows are deleted. Run records are <b>redacted in place</b> — the decision trail
                must survive for audit, so the person is removed from it rather than the record.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={erase}
                disabled={busy !== null}
                className="gap-1.5"
              >
                <ShieldX className="size-4" />
                {busy === 'erase'
                  ? 'Erasing…'
                  : `Erase from ${preview.stores.length} store${preview.stores.length === 1 ? '' : 's'}${embeddedTotal ? ` and ${embeddedTotal} copies` : ''}`}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {/* THE PROOF — re-queried after the deletion, not asserted. */}
      {report ? (
        <div
          className={`space-y-1 rounded-md border p-3 text-xs ${
            report.proven
              ? 'border-primary/40 bg-primary/[0.05]'
              : 'border-amber-500/40 bg-amber-500/[0.06]'
          }`}
        >
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            {report.proven ? (
              <CheckCircle className="size-4 text-primary" weight="fill" />
            ) : (
              <Warning className="size-4 text-amber-600" weight="fill" />
            )}
            {report.proven ? 'Erased — verified, no copies remain' : 'Erased in part'}
          </p>
          <p className="text-muted-foreground">
            {report.erasedRows ?? 0} row{(report.erasedRows ?? 0) === 1 ? '' : 's'} deleted ·{' '}
            {(report.embedded ?? []).reduce((n, e) => n + e.chunksDeleted, 0)} indexed chunks removed ·{' '}
            {(report.embedded ?? []).reduce((n, e) => n + e.runsRedacted, 0)} run records redacted
          </p>
          {report.embeddedRemaining ? (
            <p className="text-amber-700 dark:text-amber-500">
              {report.embeddedRemaining} copies still found on re-check — this erasure is NOT complete.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Re-checked after deletion: nothing matches this person any more.
            </p>
          )}
          {report.deferred?.length ? (
            <p className="text-amber-700 dark:text-amber-500">
              Not reachable from here: {report.deferred.join(', ')}
            </p>
          ) : null}
          {/* The systems OUTSIDE this console the erasure was pushed to. A DPO answering a request
              has to be able to name them — and name the ones that did not take it. */}
          {propagation?.length ? (
            <p className="text-muted-foreground">
              Pushed to{' '}
              {propagation
                .map((p) => `${p.target}${p.ok ? '' : ` (waiting${p.reason ? ` — ${p.reason}` : ''})`}`)
                .join(', ')}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Filed as an erasure request — it appears in the request log with this evidence attached.
          </p>
        </div>
      ) : null}
    </div>
  );
}
