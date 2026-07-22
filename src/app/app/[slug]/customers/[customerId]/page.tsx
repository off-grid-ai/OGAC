import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CrossSellCustomerJourney,
  CrossSellSourceUnavailable,
} from '@/components/app-use/CrossSellCustomerJourney';
import { readBankCrossSellOpportunityBook } from '@/lib/adapters/bank-cross-sell-execution';
import { getAppBySlug } from '@/lib/apps-store';
import { resolveDeployedApp } from '@/lib/deployed-app';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Customer detail — the deep-linkable governed decision journey. It reads the same live projection
// as the queue, so a refresh always reflects the canonical run, receipt, and outcome stores.
export default async function CustomerDetailPage({
  params,
}: Readonly<{ params: Promise<{ slug: string; customerId: string }> }>) {
  const { slug, customerId } = await params;
  const app = await getAppBySlug(slug);
  const resolved = resolveDeployedApp(app);
  if (!resolved || !app) notFound();
  const orgId = await currentOrgId();
  const book = await readBankCrossSellOpportunityBook(slug, orgId).catch(() => null);
  if (!book) {
    return (
      <main className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
        <div className="w-full max-w-[110rem] space-y-5">
          <Link
            href={`/app/${slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to opportunities
          </Link>
          <CrossSellSourceUnavailable />
        </div>
      </main>
    );
  }
  const index = book.opportunities.findIndex((item) => item.customerId === customerId);
  if (index < 0) notFound();
  const opportunity = book.opportunities[index];
  const evidence = book.evidence[index];

  return (
    <div className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
      <div className="w-full max-w-[110rem]">
        <Link
          href={`/app/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to opportunities
        </Link>
        <div className="mt-5">
          <CrossSellCustomerJourney slug={slug} opportunity={opportunity} evidence={evidence} />
        </div>
      </div>
    </div>
  );
}
