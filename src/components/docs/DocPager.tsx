import { ArrowLeft, ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { docNeighbors } from '@/lib/docs';

function href(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}

// Prev/next footer for a doc page, in sidebar order.
export function DocPager({ slug }: Readonly<{ slug: string }>) {
  const { prev, next } = docNeighbors(slug);
  if (!prev && !next) return null;
  return (
    <div className="mt-12 grid grid-cols-2 gap-3 border-t border-border pt-6">
      {prev ? (
        <Link
          href={href(prev.slug)}
          className="group rounded-lg border border-border p-3 transition-colors duration-150 hover:border-primary/40"
        >
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            <ArrowLeft className="size-3" /> Previous
          </span>
          <span className="mt-0.5 block text-sm text-foreground group-hover:text-primary">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={href(next.slug)}
          className="group rounded-lg border border-border p-3 text-right transition-colors duration-150 hover:border-primary/40"
        >
          <span className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
            Next <ArrowRight className="size-3" />
          </span>
          <span className="mt-0.5 block text-sm text-foreground group-hover:text-primary">
            {next.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
