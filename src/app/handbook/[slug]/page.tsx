import { notFound } from 'next/navigation';
import { Markdown } from '@/components/Markdown';
import { findDoc, readDoc } from '@/lib/handbook';

export const dynamic = 'force-dynamic';

export default async function HandbookDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (!doc) notFound();
  const body = await readDoc(doc);
  return <Markdown>{body}</Markdown>;
}
