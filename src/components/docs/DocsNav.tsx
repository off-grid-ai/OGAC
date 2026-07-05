'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOC_SECTIONS } from '@/lib/docs';
import { cn } from '@/lib/utils';

function href(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs';
}

// Docs sidebar — sections + pages from the content registry, with the current page highlighted.
export function DocsNav() {
  const pathname = usePathname();
  return (
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
  );
}
