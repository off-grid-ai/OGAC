'use client';

import { Play } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function RunEvalButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/evals/run', { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      const d = await res.json();
      toast.success(`Eval: ${d.passed}/${d.total} passed · ${d.score}%`);
      router.refresh();
    } catch {
      toast.error('Eval failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" onClick={run} disabled={busy}>
      <Play className="size-4" />
      {busy ? 'Running…' : 'Run eval'}
    </Button>
  );
}
