import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAppBySlug } from '@/lib/apps-store';
import { cockpitCustomer } from '@/lib/cockpit-fixtures';
import { formatInr, maskPan, STAGE_PROBABILITY } from '@/lib/cockpit-metrics';
import { resolveDeployedApp } from '@/lib/deployed-app';

export const dynamic = 'force-dynamic';

// Customer detail — the deep-linkable drill-in from the cockpit's top-opportunities table. Its own
// route/URL (list → detail everywhere). PII is masked (PAN) as it would be on any shared surface.
export default async function CustomerDetailPage({
  params,
}: Readonly<{ params: Promise<{ slug: string; customerId: string }> }>) {
  const { slug, customerId } = await params;
  const resolved = resolveDeployedApp(await getAppBySlug(slug));
  const customer = cockpitCustomer(customerId);
  if (!resolved || !customer) notFound();

  const expected = Math.round(customer.opportunityInr * STAGE_PROBABILITY[customer.stage]);

  return (
    <div className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <Link
          href={`/app/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to cockpit
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{customer.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {customer.segment} · {customer.region} · with the bank {customer.tenureMonths} months
            </p>
          </div>
          <Badge variant="secondary" className="bg-primary/10 capitalize text-primary">
            {customer.stage}
          </Badge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                Assets under management
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums text-foreground">
              {formatInr(customer.aumInr)}
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                Opportunity ticket
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums text-foreground">
              {formatInr(customer.opportunityInr)}
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                Expected value
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums text-primary">
              {formatInr(expected)}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Next best action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-lg font-medium text-foreground">{customer.nextBestProduct}</p>
              <p className="text-sm text-muted-foreground">{customer.rationale}</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Relationship</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Customer ID" value={customer.id} mono />
              <Row label="PAN" value={maskPan(customer.pan)} mono />
              <Row label="IFSC" value={customer.ifsc} mono />
              <div>
                <p className="text-xs text-muted-foreground">Current products</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {customer.products.map((p) => (
                    <Badge key={p} variant="outline" className="text-[11px]">
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs text-foreground' : 'text-foreground'}>{value}</span>
    </div>
  );
}
