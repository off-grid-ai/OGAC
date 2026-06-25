'use client';

import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Trigger an Agent-QA sweep (offline eval + drift) on demand — POST /api/v1/admin/qa/sweep.
// Returns 200 healthy / 503 degraded; we toast the verdict and refresh the dashboard.
export function RunSweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sweep() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/qa/sweep', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { degraded?: boolean; score?: number };
      if (data.degraded) {
        toast.warning(`Sweep complete — degraded (score ${data.score ?? '—'})`);
      } else {
        toast.success(`Sweep complete — healthy (score ${data.score ?? '—'})`);
      }
      router.refresh();
    } catch {
      toast.error('Sweep failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={sweep} disabled={busy}>
      <ArrowsClockwise className={busy ? 'size-4 animate-spin' : 'size-4'} />
      {busy ? 'Running sweep…' : 'Run QA sweep'}
    </Button>
  );
}
