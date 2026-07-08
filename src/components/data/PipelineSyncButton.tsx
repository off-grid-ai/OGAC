'use client';

import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// "Run sync" for a data-movement pipeline. POSTs to /api/v1/admin/etl/sync, then polls the job
// status a few times so the operator sees it move off "pending". Refreshes the server page on
// completion so the job history reflects the new run. Real action against the live engine.
export function PipelineSyncButton({
  connectionId,
  name,
}: {
  connectionId: string;
  name: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function poll(jobId: number, tries: number): Promise<void> {
    if (tries <= 0) return;
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/v1/admin/etl/sync?jobId=${jobId}`);
    if (!res.ok) return;
    const job = (await res.json().catch(() => ({}))) as { status?: string };
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      toast[job.status === 'succeeded' ? 'success' : 'error'](`${name}: sync ${job.status}`);
      router.refresh();
      return;
    }
    return poll(jobId, tries - 1);
  }

  async function run() {
    setRunning(true);
    try {
      const res = await fetch('/api/v1/admin/etl/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      });
      const job = (await res.json().catch(() => ({}))) as { jobId?: number | null; error?: string };
      if (!res.ok) {
        toast.error(job.error || 'Could not start the sync');
        return;
      }
      toast.success(`Started sync for ${name}`);
      router.refresh();
      if (typeof job.jobId === 'number') await poll(job.jobId, 10);
    } catch {
      toast.error('Could not start the sync');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={running}>
      <ArrowsClockwise className={`size-4 ${running ? 'animate-spin' : ''}`} />
      {running ? 'Syncing…' : 'Run sync'}
    </Button>
  );
}
