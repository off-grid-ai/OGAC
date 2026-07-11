'use client';

// The SIEM security-event stream renders up to ~500 newest events in one table (readSiemView).
// That's genuinely unbounded/data-heavy, so we page it client-side over the already-fetched array
// via the shared URL-driven pagination (nav-in-URL rule → ?evPage / ?evSize) and the common control.
// Purely presentational apart from the URL wiring; the events + outcome filtering are computed
// server-side and passed in.

import { Pagination } from '@/components/ui/Pagination';
import { toDisplayHost } from '@/lib/display-host';
import type { SiemEvent, SiemOutcome } from '@/lib/siem-view';
import { usePagination } from '@/lib/use-pagination';

export function SiemEventsTable({ events }: { events: SiemEvent[] }) {
  const { pageItems, ...state } = usePagination(events, { key: 'ev', defaultPageSize: 25 });

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No security events recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Action</th>
              <th className="p-2">Outcome</th>
              <th className="p-2">Source IP</th>
              <th className="p-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((e) => (
              <tr key={e.id} className="border-t border-border align-top">
                <td className="p-2 text-xs text-muted-foreground">
                  {e.ts ? new Date(e.ts).toLocaleString() : '—'}
                </td>
                <td className="p-2">{e.actor}</td>
                <td className="p-2">{e.action}</td>
                <td className="p-2">
                  <OutcomeBadge outcome={e.outcome} />
                </td>
                <td className="p-2 font-mono text-xs">{e.ip ? toDisplayHost(e.ip) : '—'}</td>
                <td className="max-w-xs truncate p-2 text-muted-foreground">{e.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        state={state}
        onPageChange={state.setPage}
        onPageSizeChange={state.setPageSize}
        itemLabel="events"
      />
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: SiemOutcome }) {
  const danger = outcome === 'denied' || outcome === 'blocked' || outcome === 'error';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${danger ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'}`}
    >
      {outcome}
    </span>
  );
}
