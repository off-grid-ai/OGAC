import Link from 'next/link';
import type { ReactNode } from 'react';
import { HANDBOOK } from '@/lib/handbook';

// Public, hosted handbook — the prose docs, alongside the API reference at /docs.
export default function HandbookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl gap-8 px-6 py-8">
      <aside className="w-60 shrink-0">
        <Link href="/" className="text-sm font-semibold tracking-tight text-foreground">
          Off Grid <span className="text-primary">Console</span>
        </Link>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Handbook
        </p>
        <nav className="mt-5 space-y-1">
          {HANDBOOK.map((d) => (
            <Link
              key={d.slug}
              href={`/handbook/${d.slug}`}
              className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {d.title}
            </Link>
          ))}
          <a
            href="/docs"
            className="mt-3 block rounded-md px-3 py-2 text-sm text-primary hover:opacity-80"
          >
            API reference →
          </a>
        </nav>
      </aside>
      <main className="min-w-0 flex-1 pb-16">{children}</main>
    </div>
  );
}
