'use client';

import { cn } from '@/lib/utils';

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

// On-page table of contents (right rail). Anchors to the heading ids DocsMarkdown renders.
export function DocToc({ headings }: { headings: Heading[] }) {
  if (headings.length < 2) return null;
  return (
    <aside className="hidden w-48 shrink-0 xl:block">
      <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
          On this page
        </div>
        <nav className="space-y-1 text-xs">
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={cn(
                'block text-muted-foreground transition-colors duration-150 hover:text-foreground',
                h.level === 3 && 'pl-3',
              )}
            >
              {h.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
