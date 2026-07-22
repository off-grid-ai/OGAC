import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { OutcomeEntryForm } from '@/components/outcomes/OutcomeEntryForm';
import { OutcomeReadOnlyNotice } from '@/components/outcomes/OutcomeReadOnlyNotice';
import { getRunActionOutcomeContext } from '@/components/outcomes/outcome-page-data';
import type { ActionOutcomeCode } from '@/lib/action-outcome-contract';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function NewActionOutcomePage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string; runId: string; stepId: string }>;
  searchParams: Promise<{ result?: string }>;
}>) {
  await requireModuleForUser('studio');
  const [{ id, runId, stepId }, query, orgId, session] = await Promise.all([
    params,
    searchParams,
    currentOrgId(),
    auth(),
  ]);
  const context = await getRunActionOutcomeContext({ appId: id, runId, stepId, orgId });
  if (!context) notFound();
  if (session?.user?.role !== 'admin') {
    return <OutcomeReadOnlyNotice appId={id} runId={runId} />;
  }
  const defaultCode: ActionOutcomeCode = query.result === 'converted' ? 'converted' : 'accepted';

  return (
    <OutcomeEntryForm
      appId={id}
      runId={runId}
      stepId={stepId}
      eventId={`human:${randomUUID()}`}
      mode="observed"
      defaultCode={defaultCode}
      initialObservedAt={new Date().toISOString()}
    />
  );
}
