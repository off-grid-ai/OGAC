import { AccountingInsightsSource } from '@/app/(console)/insights/accounting/content';

export default function CostModelsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ range?: string; pipeline?: string }> }>) {
  return <AccountingInsightsSource destination="models" searchParams={searchParams} />;
}
