'use client';

import {
  DotsThree as MoreHorizontal,
  ArrowsClockwise as RefreshCw,
  Trash as Trash2,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ConnectorActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();

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
