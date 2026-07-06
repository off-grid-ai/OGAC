import Link from 'next/link';
import { ClipboardText, DownloadSimple } from '@phosphor-icons/react/dist/ssr';
import { AuditFilterBar } from '@/components/audit/AuditFilterBar';
import { StatBand } from '@/components/insights/StatBand';
import { readAuditPage } from '@/lib/audit-log-reader';
import {
  auditFiltersToQuery,
  parseAuditFilters,
  type AuditOutcome,
} from '@/lib/audit-log-view';
import { buildAuditStats } from '@/lib/insights-stats';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// The audit-log accountability surface — "who sent which chats, ran which workflows, changed what,
// when." Reads the OpenSearch `offgrid-audit` index via searchAudit (through the audit-log-reader
// adapter) and the pure audit-log view-model. EVERY filter is URL-driven (searchParams, not local
// state) per the navigation mandate, so the view is linkable, shareable, and Back-coherent.
// Best-effort: an unconfigured/unreachable index degrades to an empty table + a note, never a throw.
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleForUser('audit');
  const sp = await searchParams;
  const get = (k: string): string | null => {
    const v = sp[k];
    return typeof v === 'string' ? v : null;
  };
  const filters = parseAuditFilters(get);
  const { rows, total, page, size, configured, error, facets } = await readAuditPage(filters);

  const pageCount = Math.max(1, Math.ceil(total / size));
  const query = auditFiltersToQuery(filters);
  const exportBase = `/api/v1/admin/audit-log/export`;
  const exportCsv = `${exportBase}?format=csv${query ? `&${query}` : ''}`;
  const exportJson = `${exportBase}?format=json${query ? `&${query}` : ''}`;

  const pageHref = (p: number) => {
    const q = auditFiltersToQuery({ ...filters, page: p }, { includePaging: true });
    return `/audit${q ? `?${q}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ClipboardText className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Who did what, to what, on which project — every audited action attributed to an actor,
              with model, tokens, cost, and outcome. Filter and export for compliance.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportLink href={exportCsv} label="CSV" />
          <ExportLink href={exportJson} label="JSON" />
        </div>
      </div>

      {!configured && (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          OpenSearch is not configured (<code>OFFGRID_OPENSEARCH_URL</code>). No audit events to
          show.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          Could not reach the audit index: {error}
        </p>
      )}

      {/* Value-forward summary band — total matches + distinct actors/actions/projects in view. */}
      <StatBand
        stats={buildAuditStats({
          total,
          distinctActors: facets.actors.length,
          distinctActions: facets.actions.length,
          distinctProjects: facets.projects.length,
        })}
      />

      <AuditFilterBar
        actors={facets.actors}
        actions={facets.actions}
        projects={facets.projects}
        outcomes={facets.outcomes}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Action</th>
                <th className="p-2">Project</th>
                <th className="p-2">Resource</th>
                <th className="p-2">Model</th>
                <th className="p-2 text-right">Tokens</th>
                <th className="p-2 text-right">Cost</th>
                <th className="p-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap p-2 text-xs text-muted-foreground">
                    {r.ts ? new Date(r.ts).toLocaleString() : '—'}
                  </td>
                  <td className="p-2">
                    <span className="text-foreground">{r.actor}</span>
                    {r.actorType !== 'unknown' && (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground/60">
                        {r.actorType}
                      </span>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">{r.action}</td>
                  <td className="p-2 text-muted-foreground">{r.project || '—'}</td>
                  <td className="max-w-[16rem] truncate p-2 text-muted-foreground">
                    {r.resource || '—'}
                  </td>
                  <td className="p-2 text-muted-foreground">{r.model || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{r.tokens || '—'}</td>
                  <td className="p-2 text-right tabular-nums">
                    {r.costUsd ? `$${r.costUsd.toFixed(4)}` : '—'}
                  </td>
                  <td className="p-2">
                    <OutcomeBadge outcome={r.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — URL-driven (?page=N). Back steps to the previous page. */}
      {total > size && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <PageLink href={pageHref(Math.max(1, page - 1))} disabled={page <= 1} label="Prev" />
            <span className="px-2">
              page {page} / {pageCount}
            </span>
            <PageLink
              href={pageHref(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
              label="Next"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <DownloadSimple className="size-3.5" />
      {label}
    </a>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return <span className="rounded-md border border-border px-2 py-1 opacity-40">{label}</span>;
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-border px-2 py-1 hover:bg-muted hover:text-foreground"
    >
      {label}
    </Link>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const danger = outcome === 'denied' || outcome === 'blocked' || outcome === 'error';
  const good = outcome === 'ok';
  const cls = danger
    ? 'bg-destructive/10 text-destructive'
    : good
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground';
  return <span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{outcome}</span>;
}
