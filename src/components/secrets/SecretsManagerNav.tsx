'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { SecretsManager } from './SecretsManager';

// URL-driven wrapper around SecretsManager. The add-secret panel is a navigational position, so it
// lives in the query string (?add=1) — opening/closing it pushes a history entry, so browser Back
// closes the panel rather than leaving the page (per the console nav standard).
export function SecretsManagerNav({ configured, sealed }: Readonly<{ configured: boolean; sealed: boolean }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const addOpen = params.get('add') === '1';

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

  return (
    <SecretsManager
      configured={configured}
      sealed={sealed}
      addOpen={addOpen}
      onToggleAdd={onToggleAdd}
    />
  );
}
