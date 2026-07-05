import { DocPager } from '@/components/docs/DocPager';
import { DocsMarkdown } from '@/components/docs/DocsMarkdown';
import { DocToc } from '@/components/docs/DocToc';
import { docHeadings, findDocBySlug } from '@/lib/docs';

export const dynamic = 'force-static';

// Docs home = the '' slug (What is Off Grid).
export default function DocsHome() {
  const page = findDocBySlug('');
  if (!page) return null;
  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold text-foreground">{page.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{page.description}</p>
        <div className="mt-6">
          <DocsMarkdown body={page.body} />
        </div>
        <DocPager slug="" />
      </article>
      <DocToc headings={docHeadings(page.body)} />
    </div>
  );
}
