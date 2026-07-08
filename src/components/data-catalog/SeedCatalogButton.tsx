'use client';

import { Sparkle } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Seed the catalog from the org's real connectors + declared data-domains (never fabricated). POSTs
// to the seed route, which materializes the pure proposals as data_assets.
export function SeedCatalogButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function seed() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/data-assets/seed', { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { seeded?: number };
      const n = data.seeded ?? 0;
      if (n === 0) toast.info('Nothing new to seed — the catalog already covers your connectors.');
      else toast.success(`Registered ${n} dataset${n === 1 ? '' : 's'} from your connectors.`);
      router.refresh();
    } catch {
      toast.error('Failed to seed the catalog');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={seed} disabled={busy}>
      <Sparkle className="size-4" />
      {busy ? 'Seeding…' : 'Seed from connectors'}
    </Button>
  );
}
