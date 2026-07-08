'use client';

import { Play, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

// Run-now + delete for one ETL job. "Run now" fires the governed direct-copy synchronously and
// reports the outcome (rows moved, values redacted) inline; on any terminal state it refreshes so
// the run history + last-run badge update. Delete confirms first (destructive). Real actions.
export function EtlJobActions({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}/run`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        rowsWritten?: number;
        redacted?: number;
        message?: string;
      };
      if (body.status === 'succeeded') {
        toast.success(`Moved ${body.rowsWritten ?? 0} rows · ${body.redacted ?? 0} values redacted`);
      } else {
        toast.error(body.message || 'The run failed');
      }
      router.refresh();
    } catch {
      toast.error('Could not run the job');
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this ETL job and its run history? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Could not delete the job');
        return;
      }
      toast.success('Job deleted');
      router.push('/data/etl');
    } catch {
      toast.error('Could not delete the job');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={run} disabled={running}>
        <Play className="size-4" />
        {running ? 'Running…' : 'Run now'}
      </Button>
      <Button size="sm" variant="outline" onClick={remove} disabled={deleting}>
        <Trash className="size-4" />
        Delete
      </Button>
    </div>
  );
}
