import { Database } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { AddAssetButton } from '@/components/data-catalog/AddAssetButton';
import { SeedCatalogButton } from '@/components/data-catalog/SeedCatalogButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listAssets, listAllClassifications } from '@/lib/data-catalog-store';
import { deriveAssetPosture, type ClassificationLevel } from '@/lib/data-classification';
import { evaluateFreshness } from '@/lib/data-freshness';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Level → badge tone. Ascending sensitivity; restricted is the loudest.
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

// Data catalog (M4) — "what data do I have". A list → detail surface over the org's registered
// datasets, each with its source, owner, classification posture (level + PII), row count, and
// freshness state. Seeded from connectors/data-domains; a sync can register its output asset here.
export default async function DataCatalogPage() {
  await requireModuleForUser('catalog');
  const org = await currentOrgId();
  const [assets, allClassifications] = await Promise.all([
    listAssets(org),
    listAllClassifications(org),
  ]);
  const byAsset = new Map<string, typeof allClassifications>();
  for (const c of allClassifications) {
    const arr = byAsset.get(c.assetId) ?? [];
    arr.push(c);
    byAsset.set(c.assetId, arr);
  }
  const now = new Date();
  const rows = assets.map((a) => {
    const cls = (byAsset.get(a.id) ?? []).map((c) => ({
      level: c.level,
      piiTags: c.piiTags,
      column: c.column,
    }));
    // toClassification not needed — deriveAssetPosture normalizes; pass structural view.
    const posture = deriveAssetPosture(
      cls.map((c) => ({
        level: c.level as ClassificationLevel,
        piiTags: c.piiTags,
        column: c.column ?? null,
      })),
    );
    const freshness = evaluateFreshness(
      {
        freshnessSlaHours: a.freshnessSlaHours,
        lastRefreshAt: a.lastRefreshAt,
        syncStatus: a.syncStatus,
      },
      now,
    );
    return { asset: a, posture, freshness };
  });

  const alerting = rows.filter((r) => r.freshness.alerting).length;
  const withPii = rows.filter((r) => r.posture.hasPii).length;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Database className="size-4 text-primary" />
            Data catalog
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Every dataset your org holds — its source, owner, sensitivity, PII, size, and how fresh it
            is. Click through to classify it, set retention, and see its governance posture.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SeedCatalogButton />
          <AddAssetButton />
        </div>
      </div>

      {/* Stat band — fills the width. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Datasets" value={String(assets.length)} />
        <StatCard label="Holding PII" value={String(withPii)} tone={withPii ? 'warn' : undefined} />
        <StatCard
          label="Freshness alerts"
          value={String(alerting)}
          tone={alerting ? 'bad' : undefined}
        />
        <StatCard
          label="Total rows"
          value={assets.reduce((n, a) => n + a.rowCount, 0).toLocaleString('en-IN')}
        />
      </div>

      {assets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No datasets catalogued yet. Use{' '}
            <span className="font-medium text-foreground">Seed from connectors</span> to register the
            datasets your declared connectors and data-domains already point at, or add one manually.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ asset, posture, freshness }) => (
            <Link key={asset.id} href={`/data/catalog/${asset.id}`} className="group">
              <Card className="h-full shadow-sm transition-colors group-hover:border-primary/40">
                <CardHeader className="space-y-0 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{asset.name}</CardTitle>
                    <Badge className={LEVEL_TONE[posture.effectiveLevel]}>
                      {posture.effectiveLevel}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {asset.source || '—'} · {asset.kind}
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {posture.hasPii ? (
                      <Badge className="bg-destructive/10 text-destructive">
                        PII: {posture.piiTags.join(', ')}
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground">No PII</Badge>
                    )}
                    <Badge className={FRESH_TONE[freshness.state]}>{freshness.state}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{asset.rowCount.toLocaleString('en-IN')} rows</span>
                    <span>{asset.owner || 'unowned'}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: Readonly<{ label: string; value: string; tone?: 'warn' | 'bad' }>) {
  let valueTone = 'text-foreground';
  if (tone === 'bad') valueTone = 'text-destructive';
  else if (tone === 'warn') valueTone = 'text-amber-600';
  return (
    <Card className="shadow-sm">
      <CardContent className="py-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
