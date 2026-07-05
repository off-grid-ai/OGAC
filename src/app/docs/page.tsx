import { DocsMarkdown } from '@/components/docs/DocsMarkdown';
import { findDocBySlug } from '@/lib/docs';

export const dynamic = 'force-static';

// Docs home = the '' slug (What is Off Grid).
export default function DocsHome() {
  const page = findDocBySlug('');
  if (!page) return null;
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
