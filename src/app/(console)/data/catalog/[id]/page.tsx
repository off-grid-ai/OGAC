import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AssetActions } from '@/components/data-catalog/AssetActions';
import { ClassificationManager } from '@/components/data-catalog/ClassificationManager';
import { RetentionManager } from '@/components/data-catalog/RetentionManager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getAsset,
  getRetention,
  listClassifications,
  toClassification,
} from '@/lib/data-catalog-store';
import { deriveAssetPosture, type ClassificationLevel } from '@/lib/data-classification';
import { evaluateFreshness } from '@/lib/data-freshness';
import { evaluateRetention } from '@/lib/data-retention';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

const LEVEL_TONE: Record<ClassificationLevel, string> = {
  public: 'bg-muted text-muted-foreground',
  internal: 'bg-primary/10 text-primary',
  confidential: 'bg-amber-500/10 text-amber-600',
  restricted: 'bg-destructive/10 text-destructive',
};
const FRESH_TONE: Record<string, string> = {
  fresh: 'bg-primary/10 text-primary',
  stale: 'bg-amber-500/10 text-amber-600',
  broken: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
  'no-sla': 'bg-muted text-muted-foreground',
};

// Data catalog DETAIL (M4) — the deep, deep-linkable view behind one dataset: its facts, its derived
// governance posture, and full CRUD over its classification + retention. All actions live here so an
// operator can run + maintain the dataset from its own page.
export default async function DataAssetDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('catalog');
  const { id } = await params;
  const org = await currentOrgId();
  const asset = await getAsset(id, org);
  if (!asset) notFound();

  const [classificationRows, retention] = await Promise.all([
    listClassifications(id, org),
    getRetention(id, org),
  ]);
  const posture = deriveAssetPosture(classificationRows.map(toClassification));
  const now = new Date();
  const freshness = evaluateFreshness(
    {
      freshnessSlaHours: asset.freshnessSlaHours,
      lastRefreshAt: asset.lastRefreshAt,
      syncStatus: asset.syncStatus,
    },
    now,
  );
  const retentionResult = evaluateRetention(
    {
      retainDays: retention?.retainDays ?? 0,
      action: retention?.action,
      legalHold: retention?.legalHold,
      anchorAt: asset.lastRefreshAt ?? asset.createdAt,
    },
    now,
  );

  return (
    <PageFrame>
      {
        <div className="w-full space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <Link
                href="/data/catalog"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Data catalog
              </Link>
              <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
                {asset.name}
                <Badge className={LEVEL_TONE[posture.effectiveLevel]}>
                  {posture.effectiveLevel}
                </Badge>
                <Badge className={FRESH_TONE[freshness.state]}>{freshness.state}</Badge>
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {asset.source || '—'} · {asset.kind} · {asset.rowCount.toLocaleString('en-US')} rows
              </p>
            </div>
            <AssetActions asset={asset} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Facts + posture. */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <Field label="Owner">{asset.owner || 'unowned'}</Field>
                <Field label="Description">{asset.description || '—'}</Field>
                <Field label="Governance posture">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={LEVEL_TONE[posture.effectiveLevel]}>
                      {posture.effectiveLevel}
                    </Badge>
                    {posture.hasPii ? (
                      <Badge className="bg-destructive/10 text-destructive">
                        PII: {posture.piiTags.join(', ')}
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground">No PII</Badge>
                    )}
                    <Badge
                      className={
                        posture.requiresMasking
                          ? 'bg-amber-500/10 text-amber-600'
                          : 'bg-muted text-muted-foreground'
                      }
                    >
                      {posture.requiresMasking ? 'masking required' : 'no masking'}
                    </Badge>
                    <Badge
                      className={
                        posture.egressAllowed
                          ? 'bg-primary/10 text-primary'
                          : 'bg-destructive/10 text-destructive'
                      }
                    >
                      {posture.egressAllowed ? 'egress allowed' : 'egress blocked'}
                    </Badge>
                  </div>
                </Field>
                <Field label="Freshness">{freshness.reason}</Field>
                <Field label="Retention">{retentionResult.reason}</Field>
              </CardContent>
            </Card>

            {/* Classification manager. */}
            <div className="xl:col-span-2">
              <ClassificationManager assetId={asset.id} initial={classificationRows} />
            </div>
          </div>

          {/* Retention. */}
          <RetentionManager assetId={asset.id} initial={retention} />
        </div>
      }
    </PageFrame>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}
