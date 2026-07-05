'use client';

import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DOC_SECTIONS, docIndex } from '@/lib/docs';
import { cn } from '@/lib/utils';

function href(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}

// Docs sidebar — a search box over an inline results list (no modal, per the UX mandate), falling
// back to the section/page tree with the current page highlighted.
export function DocsNav() {
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (query.length < 2) return [];
    return docIndex()
      .filter(
        (d) =>
          d.title.toLowerCase().includes(query) ||
          d.description.toLowerCase().includes(query) ||
          d.section.toLowerCase().includes(query),
      )
      .slice(0, 12);
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <MagnifyingGlass className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search docs"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none transition-colors duration-150 focus:border-primary/50"
        />
      </div>

      {query.length >= 2 ? (
        <div className="space-y-0.5 text-sm">
          {results.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No matches.</p>
          ) : (
            results.map((r) => (
              <Link
                key={r.slug || 'home'}
                href={href(r.slug)}
                onClick={() => setQ('')}
                className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                <span className="block text-foreground">{r.title}</span>
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  {r.section}
                </span>
              </Link>
            ))
          )}
        </div>
      ) : (
        <nav className="space-y-5 text-sm">
          {DOC_SECTIONS.map((section) => (
            <div key={section.id}>
              <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.pages.map((p) => {
                  const active = pathname === href(p.slug);
                  return (
                    <Link
                      key={p.slug}
                      href={href(p.slug)}
                      className={cn(
                        'block rounded-md px-2 py-1.5 transition-colors duration-150',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {p.title}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="border-t border-border pt-4">
            <a
              href="/docs/api"
              className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              API reference →
            </a>
          </div>
        </nav>
      )}
    </div>
  );
}
