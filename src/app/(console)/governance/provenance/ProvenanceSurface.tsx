import { SealCheck, Warning } from '@phosphor-icons/react/dist/ssr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { getSigning } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import { readProvenanceView } from '@/lib/provenance-view';
import { currentOrgId } from '@/lib/tenancy';
import { ProvenanceLedger } from './ProvenanceLedger';
import { RotateKeyControl } from './RotateKeyControl';

export async function ProvenanceSurface({
  embedded = false,
}: Readonly<{ embedded?: boolean }> = {}) {
  await requireModuleForUser('provenance');
  // ORG-SCOPED. Without the tenant this defaulted to the platform's own org, so every tenant was shown
  // the DEFAULT org's signed records — including another tenant's run and agent ids in the subject
  // column — while seeing none of its own.
  const orgId = await currentOrgId();
  const view = await readProvenanceView(50, orgId);
  const signing = getSigning();

  // A failed read must not render as three zeros on the page that exists to prove tamper-evidence:
  // "nothing is signed" and "we could not check" are opposite facts.
  const stats = view.error
    ? [
        { label: 'Signed records', value: 'unknown', icon: Warning },
        { label: 'Verified', value: 'unknown', icon: Warning },
        { label: 'Unverified', value: 'unknown', icon: Warning },
      ]
    : [
        { label: 'Signed records', value: String(view.total), icon: SealCheck },
        { label: 'Verified', value: String(view.verified), icon: SealCheck },
        { label: 'Unverified', value: String(view.unverified), icon: Warning },
      ];

  return (
    <div className="w-full space-y-6">
      {!embedded ? (
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <SealCheck className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Provenance</h1>
            <p className="text-sm text-muted-foreground">
              Verifiable, signed provenance for answers &amp; artifacts — each record re-verified
              against the active signing key. Tamper-evident, offline-verifiable, on-prem.
            </p>
          </div>
        </div>
      ) : null}

      {view.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          The provenance ledger could not be read ({view.error}). That is not the same as nothing being
          signed — how many records exist is unknown until this reads successfully.
        </p>
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
          <RotateKeyControl algorithm={signing.algorithm} currentPublicKey={signing.publicKey()} />
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Signed manifests</CardTitle>
          <p className="text-xs text-muted-foreground">
            Recent signed provenance records — newest first. Status is recomputed at read time from
            the signature and the active public key; use Verify to re-check any record on demand.
          </p>
        </CardHeader>
        <CardContent>
          <ProvenanceLedger rows={view.records} />
        </CardContent>
      </Card>
    </div>
  );
}
