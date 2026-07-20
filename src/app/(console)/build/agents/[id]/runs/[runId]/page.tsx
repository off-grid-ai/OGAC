import { redirect } from 'next/navigation';

export default async function LegacyAgentRunRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string; runId: string }> }>) {
  const { id, runId } = await params;
  redirect(
    `/solutions/agents/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
  );
}
