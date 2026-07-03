import Link from 'next/link';
import { ShieldWarning } from '@phosphor-icons/react/dist/ssr';
import { requireModuleForUser } from '@/lib/module-access';
import { filterByOutcome, readSiemView, type SiemOutcome } from '@/lib/siem-view';

export const dynamic = 'force-dynamic';

// Read-back view of the OpenSearch-backed security/audit event stream (SIEM). Outcome filtering is
// driven by the URL (?outcome=denied) — a server round-trip, no client state — so the view is
// linkable and history-aware. Best-effort: an unreachable index degrades to zeros + an error note.
export default async function SiemPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  await requireModuleForUser('control');
  const { outcome } = await searchParams;
  const { configured, data, error } = await readSiemView();
  const view = filterByOutcome(data, outcome);
  const active = data.byOutcome.some((o) => o.outcome === outcome) ? outcome : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldWarning className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Security Events</h1>
          <p className="text-sm text-muted-foreground">
            SIEM read-back — the security/audit event stream indexed in OpenSearch. Actor, action,
            outcome, and source IP for every event. Read on-prem.
          </p>
        </div>
      </div>

      {!configured && (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          OpenSearch is not configured (<code>OFFGRID_OPENSEARCH_URL</code>). No security events to
          show.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach the SIEM index: {error}
        </p>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Events</div>
          <div className="text-lg font-semibold text-foreground">{data.total}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Blocked / denied</div>
          <div className="text-lg font-semibold text-foreground">{data.blockedDenied}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Distinct actors</div>
          <div className="text-lg font-semibold text-foreground">{data.topActors.length}</div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Outcomes</div>
          <div className="text-lg font-semibold text-foreground">{data.byOutcome.length}</div>
        </div>
      </div>

      {/* Outcome filter — URL driven */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/siem"
          className={`rounded-md border px-2 py-1 ${!active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
        >
          all ({data.total})
        </Link>
        {data.byOutcome.map((o) => (
          <Link
            key={o.outcome}
            href={`/siem?outcome=${encodeURIComponent(o.outcome)}`}
            className={`rounded-md border px-2 py-1 ${active === o.outcome ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            {o.outcome} ({o.count})
          </Link>
        ))}
      </div>

      {/* Top actors rollup */}
      {data.topActors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.topActors.map((a) => (
            <span
              key={a.actor}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
            >
              {a.actor}: {a.count}
            </span>
          ))}
        </div>
      )}

      {/* Recent events */}
      {view.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No security events recorded yet.</p>
      ) : (
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
              {view.events.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="p-2 text-xs text-muted-foreground">
                    {e.ts ? new Date(e.ts).toLocaleString() : '—'}
                  </td>
                  <td className="p-2">{e.actor}</td>
                  <td className="p-2">{e.action}</td>
                  <td className="p-2">
                    <OutcomeBadge outcome={e.outcome} />
                  </td>
                  <td className="p-2 font-mono text-xs">{e.ip || '—'}</td>
                  <td className="max-w-xs truncate p-2 text-muted-foreground">{e.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
