import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { OutcomeEntryForm } from '@/components/outcomes/OutcomeEntryForm';
import { OutcomeReadOnlyNotice } from '@/components/outcomes/OutcomeReadOnlyNotice';
import { getRunActionOutcomeContext } from '@/components/outcomes/outcome-page-data';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function CorrectActionOutcomePage({
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
  if (!context?.observation || context.observation.kind === 'withdrawn') notFound();
  if (session?.user?.role !== 'admin') {
    return <OutcomeReadOnlyNotice appId={id} runId={runId} />;
  }

  return (
    <OutcomeEntryForm
      appId={id}
      runId={runId}
      stepId={context.stepId}
      eventId={`human:${randomUUID()}`}
      mode="corrected"
      initial={context.observation}
      initialObservedAt={context.observation.observedAt}
    />
  );
}
