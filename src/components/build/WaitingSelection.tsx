'use client';

import { useState, type ReactNode } from 'react';
import { BulkDecideBar } from '@/components/build/BulkDecideBar';
import type { BulkCandidate } from '@/lib/bulk-decide';

// ─── Select several cases and decide them together ───────────────────────────────────────────────────
//
// The rows themselves stay SERVER-rendered — they hold the case subject, the trail, the recommendation
// and the single-decision control, and none of that needs client state. Only the selection does, so this
// is a thin island around them: a checkbox per row, and the batch bar.
//
// Keeping the row on the server matters beyond tidiness: it is the same markup a single decision uses, so
// the batch path cannot drift into rendering a different, less careful version of a case.
export function WaitingSelection({
  appId,
  candidates,
  children,
}: Readonly<{
  appId: string;
  /** One per waiting row, in the same order as `children`. */
  candidates: BulkCandidate[];
  /** The server-rendered rows. */
  children: ReactNode[];
}>) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selected = candidates.filter((c) => picked.has(c.runId));
  // Only cases that are genuinely still waiting can be picked — a row someone else already decided is
  // shown but not selectable, rather than silently failing later in the batch.
  const selectable = candidates.filter((c) => c.pendingStepId);

  return (
    <>
      {selectable.length > 1 ? (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={picked.size > 0 && picked.size === selectable.length}
              // Indeterminate is the honest state for a partial selection; without it a half-filled
              // box reads as "none selected" and someone re-clicks, wiping what they had chosen.
              ref={(el) => {
                if (el) el.indeterminate = picked.size > 0 && picked.size < selectable.length;
              }}
              onChange={(e) =>
                setPicked(e.target.checked ? new Set(selectable.map((c) => c.runId)) : new Set())
              }
            />
            Select all {selectable.length}
          </label>
          {picked.size > 0 ? (
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {children.map((row, i) => {
        const c = candidates[i];
        if (!c) return row;
        return (
          <div key={c.runId} className="flex items-start gap-0 border-b border-border last:border-b-0">
            <label
              className="flex shrink-0 items-start px-3 pt-4"
              // The row behind this is a link to the full case; ticking a box must not navigate.
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                aria-label={`Select ${c.label}`}
                disabled={!c.pendingStepId}
                checked={picked.has(c.runId)}
                onChange={() => toggle(c.runId)}
              />
            </label>
            <div className="min-w-0 flex-1">{row}</div>
          </div>
        );
      })}

      <div className="px-4 pb-4">
        <BulkDecideBar appId={appId} selected={selected} onDone={() => setPicked(new Set())} />
      </div>
    </>
  );
}
