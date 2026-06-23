'use client';

import { DotsThree as MoreHorizontal, Power } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function DeviceActions({ deviceId, name }: { deviceId: string; name: string }) {
  const router = useRouter();

  async function kill() {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/kill`, { method: 'POST' });
    if (res.ok) {
      toast.success(`Kill switch sent to ${name}`);
      router.refresh();
    } else {
      toast.error('Failed to send kill switch');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Device actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={kill} className="text-destructive focus:text-destructive">
          <Power className="size-4" />
          Kill switch
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
