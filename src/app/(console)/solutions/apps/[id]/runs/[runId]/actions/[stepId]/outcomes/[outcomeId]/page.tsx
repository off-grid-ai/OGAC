import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { OutcomeDetail } from '@/components/outcomes/OutcomeDetail';
import { getRunActionOutcomeContext } from '@/components/outcomes/outcome-page-data';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function ActionOutcomeDetailPage({
  params,
}: Readonly<{
  params: Promise<{ id: string; runId: string; stepId: string; outcomeId: string }>;
}>) {
  await requireModuleForUser('studio');
  const [{ id, runId, stepId, outcomeId }, orgId, session] = await Promise.all([
    params,
    currentOrgId(),
    auth(),
  ]);
  const context = await getRunActionOutcomeContext({
    appId: id,
    runId,
    stepId,
    outcomeId,
    orgId,
  });
  if (!context?.observation) notFound();

  return (
    <OutcomeDetail
      appId={id}
      records={context.records}
      observation={context.observation}
      canManage={session?.user?.role === 'admin'}
      withdrawalEventId={`human:${randomUUID()}`}
      withdrawalObservedAt={new Date().toISOString()}
    />
  );
}
