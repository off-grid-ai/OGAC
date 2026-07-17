import { redirect } from 'next/navigation';

export default async function LegacyAgentDetailRedirect({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/solutions/agents/${encodeURIComponent(id)}`);
}
