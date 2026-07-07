import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DocsNav } from '@/components/docs/DocsNav';

// Public documentation shell — its own layout (not the console chrome). Left sidebar of sections,
// a content column, and a link back into the console.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/docs" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Off Grid AI" width={26} height={26} priority />
            <span className="text-sm font-medium">Off Grid AI Docs</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <a href="/docs/api" className="text-muted-foreground transition-colors hover:text-foreground">
              API reference
            </a>
            <Link
              href="/overview"
              className="inline-flex items-center gap-1 text-primary transition-colors hover:opacity-80"
            >
              Open console <ArrowSquareOut className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6">
        <aside className="hidden w-56 shrink-0 md:block">
          {/* Own scroll region, pinned under the 3.5rem header — so a tall nav never drags the page
              scroll on a short content page. */}
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-1">
            <DocsNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-8">{children}</main>
      </div>
    </div>
  );
}
