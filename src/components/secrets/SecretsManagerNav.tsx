'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { SecretsManager } from './SecretsManager';

// URL-driven wrapper around SecretsManager. The add-secret panel AND the currently-open folder are
// both navigational positions, so they live in the query string (?add=1, ?folder=connectors/) —
// opening/closing/drilling in pushes a history entry, so browser Back steps out of a folder or
// closes the panel rather than leaving the page (per the console nav standard).
export function SecretsManagerNav({ configured, sealed }: Readonly<{ configured: boolean; sealed: boolean }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const addOpen = params.get('add') === '1';
  const folder = params.get('folder') ?? '';

  const onToggleAdd = useCallback(
    (open: boolean) => {
      const next = new URLSearchParams(params.toString());
      if (open) next.set('add', '1');
      else next.delete('add');
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  const onOpenFolder = useCallback(
    (next: string) => {
      const q = new URLSearchParams(params.toString());
      if (next) q.set('folder', next);
      else q.delete('folder');
      // Leaving/entering a folder always closes the add panel — it was scoped to the place you're
      // navigating away from.
      q.delete('add');
      const qs = q.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  return (
    <SecretsManager
      configured={configured}
      sealed={sealed}
      addOpen={addOpen}
      onToggleAdd={onToggleAdd}
      folder={folder}
      onOpenFolder={onOpenFolder}
    />
  );
}
