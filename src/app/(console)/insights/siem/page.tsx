import { ShieldWarning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StatBand } from '@/components/insights/StatBand';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { AlertingManager } from '@/components/siem/AlertingManager';
import { IndexAdminManager } from '@/components/siem/IndexAdminManager';
import { SiemEventsTable } from '@/components/siem/SiemEventsTable';
import { SuppressionManager } from '@/components/siem/SuppressionManager';
import { buildSiemStats } from '@/lib/insights-stats';
import { requireModuleForUser } from '@/lib/module-access';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { listPipelines } from '@/lib/pipelines';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { listSuppressions } from '@/lib/siem-suppress';
import { applySuppressions } from '@/lib/siem-suppress-policy';
import { filterByOutcome, readSiemView } from '@/lib/siem-view';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Read-back view of the OpenSearch-backed security/audit event stream (SIEM). Outcome filtering is
// driven by the URL (?outcome=denied) — a server round-trip, no client state — so the view is
// linkable and history-aware. Best-effort: an unreachable index degrades to zeros + an error note.
type SiemPageProps = Readonly<{
  searchParams: Promise<{ outcome?: string; pipeline?: string }>;
}>;

type SiemSurfaceProps = SiemPageProps &
  Readonly<{
    embedded?: boolean;
    basePath?: string;
  }>;

export default function SiemPage(props: SiemPageProps) {
  return <SiemSurface {...props} />;
}

export async function SiemSurface({
  searchParams,
  embedded = false,
  basePath = '/insights/siem',
}: SiemSurfaceProps) {
  await requireModuleForUser('siem');
  const { outcome, pipeline: rawPipeline } = await searchParams;
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(
    rawPipeline,
    pipelines.map((p) => p.id),
  );
  const facetName = facet ? (pipelines.find((p) => p.id === facet)?.name ?? facet) : null;
  const facetParam = facet ? `&pipeline=${encodeURIComponent(facet)}` : '';
  const [{ configured, data: raw, error }, suppressions] = await Promise.all([
    readSiemView(500, facet ? pipelineTag(facet) : null),
    listSuppressions(orgId).catch(() => []),
  ]);
  // Apply suppression rules first, then the URL outcome filter — so muted noise never inflates the
  // tiles, actor rollup, or outcome facets. Both are pure transforms over the read-back view.
  const data = applySuppressions(raw, suppressions);
  const view = filterByOutcome(data, outcome);
  const active = data.byOutcome.some((o) => o.outcome === outcome) ? outcome : undefined;

  return (
    <PageFrame embedded={embedded}>
      {
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            {!embedded ? (
              <>
                <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ShieldWarning className="size-4" />
                </div>
                <div className="flex-1">
                  <h1 className="text-lg font-semibold text-foreground">Security Events</h1>
                  <p className="text-sm text-muted-foreground">
                    SIEM read-back — the security/audit event stream indexed in OpenSearch. Actor,
                    action, outcome, and source IP for every event. Read on-prem.
                    {facetName ? (
                      <span className="text-foreground"> Filtered to pipeline “{facetName}”.</span>
                    ) : null}
                  </p>
                </div>
              </>
            ) : (
              <span className="flex-1" />
            )}
            <PipelineFacetSelect
              pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
              resetParams={[]}
            />
          </div>

          {!configured && (
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              OpenSearch isn&apos;t connected yet — connect it in Settings. No security events to
              show.
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              Could not reach the SIEM index: {error}
            </p>
          )}

          {/* Summary tiles — value-forward stat band shared across the Insights surfaces. */}
          <StatBand
            stats={buildSiemStats({
              total: data.total,
              blockedDenied: data.blockedDenied,
              distinctActors: data.topActors.length,
              distinctOutcomes: data.byOutcome.length,
            })}
          />

          {/* Outcome filter — URL driven */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={facet ? `${basePath}?pipeline=${encodeURIComponent(facet)}` : basePath}
              className={`rounded-md border px-2 py-1 ${!active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
            >
              all ({data.total})
            </Link>
            {data.byOutcome.map((o) => (
              <Link
                key={o.outcome}
                href={`${basePath}?outcome=${encodeURIComponent(o.outcome)}${facetParam}`}
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

          {/* Recent events — paged client-side over the fetched stream (shared Pagination control). */}
          <SiemEventsTable events={view.events} />

          {/* Management: suppression rules mute known-noise events (a scanner IP, a service account, a
          health-probe path) so the feed stays signal. Applied server-side to the whole view. */}
          <SuppressionManager rules={suppressions} />

          {/* Management: OpenSearch alerting monitors (threshold triggers over the audit/gateway
          indices) + the ISM retention/rollover policy. URL-driven (?panel=alerting, ?atab=). */}
          <AlertingManager />

          {/* Read-only context around the writable ISM policy: the index templates + write-aliases
          that back the audit/gateway indices, plus native security-analytics detectors + firing
          state. URL-driven (?ipanel=index-admin, ?itab=, ?isel=). */}
          <IndexAdminManager />
        </div>
      }
    </PageFrame>
  );
}
