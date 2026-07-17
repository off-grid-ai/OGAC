import {
  CheckCircle,
  Circle,
  DownloadSimple as Download,
  Printer,
  Warning,
} from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatRail } from '@/components/ui/StatRail';
import { requireModuleForUser } from '@/lib/module-access';
import {
  buildPosture,
  COMPLIANCE_ARTIFACTS,
  controlBriefs,
  INDIA_BFSI_FRAMINGS,
  PILLAR_LABELS,
  PILLARS,
  rollupFramings,
  summariseArtifacts,
  summarisePosture,
  type ArtifactStatus,
  type PillarId,
  type PostureItem,
  type PostureStatus,
} from '@/lib/trust-center';
import { collectPostureInputs } from '@/lib/trust-center-inputs';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// The Trust & Security Center — the evidence surface for a BFSI buyer's CISO/procurement/risk gate.
// Thin renderer: it collects the live posture snapshot (I/O adapter), derives everything with the
// PURE trust-center layer, and lays it out full-width. Copy is capability-language only (no
// OSS-engine names). Structured so a public/shareable read-only variant is a trivial fork later.

const POSTURE_STYLE: Record<PostureStatus, string> = {
  implemented: 'bg-primary/10 text-primary',
  'in-progress': 'bg-amber-500/10 text-amber-600',
  planned: 'text-muted-foreground',
  'not-applicable': 'text-muted-foreground',
};

const POSTURE_LABEL: Record<PostureStatus, string> = {
  implemented: 'Implemented',
  'in-progress': 'In progress',
  planned: 'Planned',
  'not-applicable': 'N/A',
};

const ARTIFACT_STYLE: Record<ArtifactStatus, string> = {
  available: 'bg-primary/10 text-primary',
  template: 'bg-blue-500/10 text-blue-600',
  planned: 'text-muted-foreground',
};

const ARTIFACT_LABEL: Record<ArtifactStatus, string> = {
  available: 'Available',
  template: 'Generated',
  planned: 'Planned',
};

export default async function TrustCenterPage() {
  await requireModuleForUser('trust');

  const inputs = await collectPostureInputs();
  const posture = buildPosture(inputs);
  const summary = summarisePosture(posture, new Date().toISOString());
  const framings = rollupFramings(INDIA_BFSI_FRAMINGS, posture);
  const artifacts = COMPLIANCE_ARTIFACTS;
  const artifactSummary = summariseArtifacts(artifacts);

  // Pillars that carry posture items (compliance-artifacts has its own dedicated section).
  const posturePillars: PillarId[] = PILLARS.filter((p) => p !== 'compliance-artifacts');

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          {/* Header + headline posture + export */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="shadow-sm lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Trust &amp; Security Center</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>
                  Everything a security, risk, or procurement reviewer needs to clear their
                  due-diligence gate — the platform&apos;s security posture, how your data is
                  governed and kept resident, how every AI action is made observable, attributable,
                  and reversible, and how all of it maps to the regulations you answer to. Posture
                  is reported honestly: items still being hardened are shown as{' '}
                  <span className="font-medium text-amber-600">in progress</span>, never claimed
                  complete.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <a href="/api/v1/admin/trust/export">
                      <Download className="size-4" />
                      Download trust summary
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href="/api/v1/admin/trust/export" target="_blank" rel="noreferrer">
                      <Printer className="size-4" />
                      Open printable report
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                  Posture — applicable controls implemented
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold text-foreground">{summary.score}%</div>
                <Progress value={summary.score} className="mt-3" />
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-primary">{summary.totals.implemented}</span>{' '}
                    implemented
                  </span>
                  <span>
                    <span className="font-medium text-amber-600">{summary.totals.inProgress}</span>{' '}
                    in progress
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{summary.totals.planned}</span>{' '}
                    planned
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pillar rollup band — horizontal rail on mobile, restored 4-col grid on desktop. */}
          <StatRail cols={4}>
            {summary.pillars
              .filter((p) => p.total > 0)
              .map((p) => (
                <Card key={p.pillar} className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                      {PILLAR_LABELS[p.pillar]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-foreground">
                      <span className="text-2xl font-semibold text-primary">{p.implemented}</span>
                      <span className="text-muted-foreground"> / {p.total} implemented</span>
                    </div>
                    {p.inProgress > 0 && (
                      <div className="mt-1 text-xs text-amber-600">{p.inProgress} in progress</div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </StatRail>

          {/* Posture pillars — each a grid of items */}
          {posturePillars.map((pillar) => {
            const items = posture.filter((p) => p.pillar === pillar);
            if (items.length === 0) return null;
            return (
              <Card key={pillar} className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm">{PILLAR_LABELS[pillar]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {items.map((it) => (
                      <PostureCard key={it.id} item={it} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Regulatory mapping — India BFSI framings mapped to the shipped control catalogue */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Regulatory mapping — India BFSI</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The console maps its controls to the global AI frameworks (ISO/IEC 42001, NIST AI
                RMF, EU AI Act) in the Regulatory module. Below, those same controls are re-framed
                against the regulators an Indian bank or insurer answers to — each expectation links
                to the mapped controls that provide its evidence.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {framings.map((f) => {
                  const briefs = controlBriefs(f.controlIds);
                  return (
                    <div key={f.id} className="rounded-lg border border-border/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">{f.name}</div>
                          <div className="text-xs text-muted-foreground">{f.regulator}</div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 bg-primary/10 text-primary">
                          {f.coverage}% evidenced
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{f.summary}</p>
                      <div className="mt-3">
                        <Progress value={f.coverage} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {briefs.map((b) => (
                          <Badge
                            key={b.id}
                            variant="secondary"
                            className="font-mono text-[11px]"
                            title={b.title}
                          >
                            {b.ref}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Compliance-artifact checklist — honest statuses */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Compliance artifacts</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  The procurement pack a reviewer requests. Statuses are honest:{' '}
                  <span className="text-blue-600">generated</span> means we produce it live from the
                  control plane, <span className="text-primary">available</span> means a produced
                  document exists, <span>planned</span> means it is on the roadmap.
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                {artifactSummary.available + artifactSummary.template} of {artifactSummary.total}{' '}
                ready
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {artifacts.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">{a.name}</div>
                      {a.status === 'planned' ? (
                        <Circle className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <CheckCircle className="size-4 shrink-0 text-primary" weight="fill" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                    <Badge variant="secondary" className={`mt-2 ${ARTIFACT_STYLE[a.status]}`}>
                      {ARTIFACT_LABEL[a.status]}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}

function PostureCard({ item }: Readonly<{ item: PostureItem }>) {
  const briefs = controlBriefs(item.evidenceFor);
  const inProgress = item.status === 'in-progress';
  let statusIcon = <Circle className="size-4 shrink-0 text-muted-foreground" />;
  if (inProgress) {
    statusIcon = <Warning className="size-4 shrink-0 text-amber-600" />;
  } else if (item.status === 'implemented') {
    statusIcon = <CheckCircle className="size-4 shrink-0 text-primary" weight="fill" />;
  }
  return (
    <div className="flex h-full flex-col rounded-lg border border-border/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{item.title}</div>
        {statusIcon}
      </div>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">{item.detail}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className={POSTURE_STYLE[item.status]}>
          {POSTURE_LABEL[item.status]}
        </Badge>
        {briefs.map((b) => (
          <Badge
            key={b.id}
            variant="secondary"
            className="font-mono text-[11px] text-muted-foreground"
            title={b.title}
          >
            {b.ref}
          </Badge>
        ))}
      </div>
    </div>
  );
}
