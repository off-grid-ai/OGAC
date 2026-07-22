import { SealCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { getSigning } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import { readProvenanceView } from '@/lib/provenance-view';
import { ProvenanceLedger } from './ProvenanceLedger';
import { RotateKeyControl } from './RotateKeyControl';

export async function ProvenanceSurface({
  embedded = false,
}: Readonly<{ embedded?: boolean }> = {}) {
  await requireModuleForUser('provenance');
  const view = await readProvenanceView(50);
  const signing = getSigning();

  const stats = [
    { label: 'Signed records', value: String(view.total), icon: SealCheck },
    { label: 'Verified', value: String(view.verified), icon: SealCheck },
    { label: 'Unverified', value: String(view.unverified), icon: Warning },
  ];

  return (
    <PageFrame embedded={embedded}>
      <div className="w-full space-y-6">
        {!embedded ? (
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <SealCheck className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Provenance</h1>
              <p className="text-sm text-muted-foreground">
                Verifiable, signed provenance for answers &amp; artifacts — each record
                re-verified against the active signing key. Tamper-evident, offline-verifiable,
                on-prem.
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <StatRail at="sm" cols={3} className="lg:col-span-2">
            {stats.map((stat) => (
              <Card key={stat.label} className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </CardTitle>
                  <stat.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold text-foreground">{stat.value}</div>
                </CardContent>
              </Card>
            ))}
          </StatRail>
          <div className="lg:col-span-1">
            <RotateKeyControl
              algorithm={signing.algorithm}
              currentPublicKey={signing.publicKey()}
            />
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Signed manifests</CardTitle>
            <p className="text-xs text-muted-foreground">
              Recent signed provenance records — newest first. Status is recomputed at read time
              from the signature and the active public key; use Verify to re-check any record on
              demand.
            </p>
          </CardHeader>
          <CardContent>
            <ProvenanceLedger rows={view.records} />
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  );
}
