import { notFound } from 'next/navigation';
import { DocsMarkdown } from '@/components/docs/DocsMarkdown';
import { allDocSlugs, findDocBySlug } from '@/lib/docs';

export const dynamic = 'force-static';

// Pre-render every doc slug (excluding the '' home, which is /docs).
export function generateStaticParams() {
  return allDocSlugs()
    .filter(Boolean)
    .map((slug) => ({ slug: slug.split('/') }));
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = findDocBySlug(slug.join('/'));
  if (!page) notFound();
  return (
    <article>
      <h1 className="text-2xl font-semibold text-foreground">{page.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{page.description}</p>
      <div className="mt-6">
        <DocsMarkdown body={page.body} />
      </div>
    </article>
  );
}
