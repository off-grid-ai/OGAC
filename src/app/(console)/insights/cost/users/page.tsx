import { AccountingInsightsSource } from '@/app/(console)/insights/accounting/page';

export default function CostUsersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ range?: string; pipeline?: string }> }>) {
  return <AccountingInsightsSource destination="users" searchParams={searchParams} />;
}
