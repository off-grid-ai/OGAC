'use client';

import {
  DotsThree as MoreHorizontal,
  Plugs,
  ArrowsClockwise as RefreshCw,
  Trash as Trash2,
  SlidersHorizontal,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ConnectorActions({
  id,
  name,
  type,
}: Readonly<{ id: string; name: string; type?: string }>) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);

  if (type?.toLowerCase() === 'kafka') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/data/connectors/${encodeURIComponent(id)}`}>
          <SlidersHorizontal className="size-4" /> Manage source
        </Link>
      </Button>
    );
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    const toastId = toast.loading(`Testing ${name}…`);
    try {
      const res = await fetch(`/api/v1/admin/connectors/${id}/test`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (res.ok && body?.ok) {
        toast.success(body.message ?? 'Connected', { id: toastId });
      } else {
        toast.error(body?.message ?? 'Connection failed', { id: toastId });
      }
    } catch {
      toast.error('Connection test failed', { id: toastId });
    } finally {
      setTesting(false);
    }
  }

  async function sync() {
    const res = await fetch(`/api/v1/admin/connectors/${id}/sync`, { method: 'POST' });
    if (res.ok) {
      const job = await res.json();
      toast.success(`Synced ${name} · ${job.records.toLocaleString()} records`);
      router.refresh();
    } else {
      toast.error('Sync failed');
    }
  }

  async function remove() {
    const res = await fetch(`/api/v1/admin/connectors/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`Removed ${name}`);
      router.refresh();
    } else {
      toast.error('Failed to remove connector');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Connector actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={test} disabled={testing}>
          <Plugs className="size-4" />
          Test connection
        </DropdownMenuItem>
        <DropdownMenuItem onClick={sync}>
          <RefreshCw className="size-4" />
          Sync now
        </DropdownMenuItem>
        <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
          <Trash2 className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
