import { AccountingInsightsSource } from '@/app/(console)/insights/accounting/page';

export default function CostOverviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ range?: string; pipeline?: string }> }>) {
  return <AccountingInsightsSource destination="overview" searchParams={searchParams} />;
}
