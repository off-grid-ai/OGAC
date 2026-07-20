import { redirect } from 'next/navigation';

export default async function LegacyQualityExecutionDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  redirect(`/solutions/quality/runs/${encodeURIComponent(id)}`);
}
