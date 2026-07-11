import { notFound } from 'next/navigation';
import { DocPager } from '@/components/docs/DocPager';
import { DocsMarkdown } from '@/components/docs/DocsMarkdown';
import { DocToc } from '@/components/docs/DocToc';
import { allDocSlugs, docHeadings, findDocBySlug } from '@/lib/docs';

export const dynamic = 'force-static';

// Pre-render every doc slug (excluding the '' home, which is /docs).
export function generateStaticParams() {
  return allDocSlugs()
    .filter(Boolean)
    .map((slug) => ({ slug: slug.split('/') }));
}

export default async function DocPage({ params }: Readonly<{ params: Promise<{ slug: string[] }> }>) {
  const { slug } = await params;
  const key = slug.join('/');
  const page = findDocBySlug(key);
  if (!page) notFound();
  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold text-foreground">{page.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{page.description}</p>
        <div className="mt-6">
          <DocsMarkdown body={page.body} />
        </div>
        <DocPager slug={key} />
      </article>
      <DocToc headings={docHeadings(page.body)} />
    </div>
  );
}
