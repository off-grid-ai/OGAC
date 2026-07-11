import { ShieldCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { RtbfForm } from '@/components/data-catalog/RtbfForm';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  listAllClassifications,
  listAssets,
  listErasureRequests,
  listRetentionPolicies,
} from '@/lib/data-catalog-store';
import { deriveAssetPosture, type ClassificationLevel } from '@/lib/data-classification';
import { evaluateFreshness, summarizeFreshness, type FreshnessResult } from '@/lib/data-freshness';
import { evaluateRetention } from '@/lib/data-retention';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const FRESH_TONE: Record<string, string> = {
  fresh: 'bg-primary/10 text-primary',
  stale: 'bg-amber-500/10 text-amber-600',
  broken: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
  'no-sla': 'bg-muted text-muted-foreground',
};
const STATUS_TONE: Record<string, string> = {
  completed: 'bg-primary/10 text-primary',
  recorded: 'bg-muted text-muted-foreground',
  partial: 'bg-amber-500/10 text-amber-600',
  failed: 'bg-destructive/10 text-destructive',
};

// Data governance (M4) — the org's freshness/broken-sync alerts, retention-due datasets, and the
// RTBF / subject-erasure flow with its durable request history. Honest empty states until real
// syncs + a data engine flow.
export default async function DataGovernancePage() {
  await requireModuleForUser('governance');
  const org = await currentOrgId();
  const [assets, allClassifications, retentions, requests] = await Promise.all([
    listAssets(org),
    listAllClassifications(org),
    listRetentionPolicies(org),
    listErasureRequests(org),
  ]);

  const retentionByAsset = new Map(retentions.map((r) => [r.assetId, r]));
  const classByAsset = new Map<string, typeof allClassifications>();
  for (const c of allClassifications) {
    const arr = classByAsset.get(c.assetId) ?? [];
    arr.push(c);
    classByAsset.set(c.assetId, arr);
  }
  const now = new Date();

  const evaluated = assets.map((a) => {
    const freshness = evaluateFreshness(
      { freshnessSlaHours: a.freshnessSlaHours, lastRefreshAt: a.lastRefreshAt, syncStatus: a.syncStatus },
      now,
    );
    const rp = retentionByAsset.get(a.id);
    const retention = evaluateRetention(
      { retainDays: rp?.retainDays ?? 0, action: rp?.action, legalHold: rp?.legalHold, anchorAt: a.lastRefreshAt ?? a.createdAt },
      now,
    );
    const posture = deriveAssetPosture(
      (classByAsset.get(a.id) ?? []).map((c) => ({
        level: c.level as ClassificationLevel,
        piiTags: c.piiTags,
        column: c.column ?? null,
      })),
    );
    return { asset: a, freshness, retention, posture };
  });

  const freshnessSummary = summarizeFreshness(evaluated.map((e) => e.freshness) as FreshnessResult[]);
  const alerts = evaluated.filter((e) => e.freshness.alerting);
  const dueForDisposal = evaluated.filter((e) => e.retention.dueForDisposal);
  const piiAssets = evaluated.filter((e) => e.posture.hasPii);

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="size-4 text-primary" />
          Data governance
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Freshness &amp; broken-sync alerts, datasets due for disposal under retention, and the
          right-to-be-forgotten flow across the warehouse, vector store, and lineage.
        </p>
      </div>

      {/* Freshness band. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Datasets" value={String(freshnessSummary.total)} />
        <StatCard label="Fresh" value={String(freshnessSummary.fresh)} />
        <StatCard label="Stale" value={String(freshnessSummary.stale)} tone={freshnessSummary.stale ? 'warn' : undefined} />
        <StatCard label="Broken sync" value={String(freshnessSummary.broken)} tone={freshnessSummary.broken ? 'bad' : undefined} />
        <StatCard label="Due for disposal" value={String(dueForDisposal.length)} tone={dueForDisposal.length ? 'warn' : undefined} />
        <StatCard label="Holding PII" value={String(piiAssets.length)} />
      </div>

      {/* Freshness / broken-sync alerts. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Warning className="size-4 text-amber-600" />
            Freshness &amp; sync alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No stale or broken datasets. Alerts appear here once a dataset misses its freshness SLA
              or a sync fails — set an SLA on a dataset in the catalog to arm it.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dataset</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((e) => (
                    <TableRow key={e.asset.id}>
                      <TableCell>
                        <Link href={`/data/catalog/${e.asset.id}`} className="text-primary hover:underline">
                          {e.asset.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge className={FRESH_TONE[e.freshness.state]}>{e.freshness.state}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.freshness.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retention due. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Due for disposal (retention)</CardTitle>
        </CardHeader>
        <CardContent>
          {dueForDisposal.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Nothing past its retention window. Set a retention policy on a dataset in the catalog to
              track disposal here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Why</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dueForDisposal.map((e) => (
                    <TableRow key={e.asset.id}>
                      <TableCell>
                        <Link href={`/data/catalog/${e.asset.id}`} className="text-primary hover:underline">
                          {e.asset.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-amber-500/10 text-amber-600">{e.retention.action}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.retention.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RTBF. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <RtbfForm />
        </div>
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Erasure requests</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No erasure requests recorded yet. Submit a subject to run a right-to-be-forgotten and
                record it here — the request captures what was erased in the console plane and what
                waits on the warehouse data engine.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rows erased</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.subject}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_TONE[r.status] ?? STATUS_TONE.recorded}>{r.status}</Badge>
                        </TableCell>
                        <TableCell>{r.erasedRows}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.createdAt).toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  const valueTone =
    tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-600' : 'text-foreground';
  return (
    <Card className="shadow-sm">
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
