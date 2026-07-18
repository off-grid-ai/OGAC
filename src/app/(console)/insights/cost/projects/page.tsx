import { AccountingInsightsSource } from '@/app/(console)/insights/accounting/page';

export default function CostProjectsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ range?: string; pipeline?: string }> }>) {
  return <AccountingInsightsSource destination="projects" searchParams={searchParams} />;
}
