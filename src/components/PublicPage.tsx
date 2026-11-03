'use client';

import { ScrollProgress } from '@offgrid/ui/operator/magic/scroll-progress';
import type { ReactNode } from 'react';

// The root of every public page (landing, features, journey, fleet control, architecture,
// handbook). It stays transparent so the library's living field shows behind the page, and it
// scopes the website's depth layer (globals.css, [data-og-public]): glass cards, hairline edges,
// a glass header. The scroll progress rail is the website's, from the same library.
export function PublicPage({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div data-og-public="" className="min-h-screen text-foreground">
      <ScrollProgress className="z-[100] h-0.5 from-(--og-primary-dark) via-(--og-primary) to-(--og-primary-light)" />
      {children}
    </div>
  );
}
