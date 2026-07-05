'use client';

import {
  ArrowClockwise,
  DotsThree as MoreHorizontal,
  Lock,
  LockKeyOpen,
  Power,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { DeviceCommand, DeviceCommandResult } from '@/lib/fleetdm';

// Device actions. Always offers the first-party kill switch. When the active MDM is FleetDM
// (`fleet`), it also exposes the real FleetDM MDM commands — lock / unlock / wipe / refetch — each
// routed through /api/v1/admin/devices/{id}/command. Destructive commands confirm first
// (delete-confirm style) since they're irreversible on the device.
export function DeviceActions({
  deviceId,
  name,
  fleet = false,
}: {
  deviceId: string;
  name: string;
  fleet?: boolean;
}) {
  const router = useRouter();

  async function kill() {
    if (!window.confirm(`Send the kill switch to "${name}"? The node executes it on next poll.`))
      return;
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/kill`, { method: 'POST' });
    if (res.ok) {
      toast.success(`Kill switch sent to ${name}`);
      router.refresh();
    } else {
      toast.error('Failed to send kill switch');
    }
  }

  async function command(cmd: DeviceCommand, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<DeviceCommandResult> & {
      error?: string;
    };
    if (!res.ok) {
      toast.error(data.error ?? `Failed to ${cmd} ${name}`);
      return;
    }
    // A macOS lock/unlock returns a PIN the operator must type into the device.
    if (data.unlockPin) {
      toast.success(`${cmd} sent to ${name} — unlock PIN: ${data.unlockPin}`, { duration: 20000 });
    } else {
      toast.success(`${cmd} ${data.status === 'requested' ? 'requested for' : 'sent to'} ${name}`);
    }
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Device actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fleet ? (
          <>
            <DropdownMenuItem onClick={() => command('refetch')}>
              <ArrowClockwise className="size-4" />
              Refetch
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => command('lock', `Lock "${name}"? It becomes unusable until unlocked.`)}
            >
              <Lock className="size-4" />
              Lock
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => command('unlock')}>
              <LockKeyOpen className="size-4" />
              Unlock
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                command('wipe', `Wipe "${name}"? This erases the device and CANNOT be undone.`)
              }
              className="text-destructive focus:text-destructive"
            >
              <Trash className="size-4" />
              Wipe
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={kill} className="text-destructive focus:text-destructive">
          <Power className="size-4" />
          Kill switch
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
