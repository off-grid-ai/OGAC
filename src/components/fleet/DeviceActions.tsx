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
import {
  type DeviceCommand,
  type DeviceCommandResult,
  isMdmControlCommand,
  mdmControlAvailable,
} from '@/lib/fleetdm';

// Whether the MDM CONTROL tier (lock / unlock / wipe) is shipping. Read once so the render and the
// click-guard agree, and so it flips in a single place when control lands.
const CONTROL_AVAILABLE = mdmControlAvailable();

// Device actions. Always offers the first-party kill switch, and (on a FleetDM host) `refetch` -
// the free-tier re-collect of host vitals, which is inventory, not control.
//
// The MDM CONTROL commands - lock / unlock / wipe - ACT on the device. That tier is COMING SOON for
// public release, so those items render disabled with a "Coming soon" label and never fire a
// request. When it ships, `mdmControlAvailable()` flips and the same items become live (destructive
// ones confirm first, since they're irreversible on the device).
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
    // Control commands (lock/unlock/wipe) are coming soon - never fire a request while gated.
    if (isMdmControlCommand(cmd) && !CONTROL_AVAILABLE) return;
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
            {/* Refetch is inventory (re-collect host vitals), free tier - always live. */}
            <DropdownMenuItem onClick={() => command('refetch')}>
              <ArrowClockwise className="size-4" />
              Refetch
            </DropdownMenuItem>
            {/* Lock / unlock / wipe ACT on the device (MDM control) - coming soon, so disabled. */}
            <DropdownMenuItem
              disabled={!CONTROL_AVAILABLE}
              onClick={() =>
                CONTROL_AVAILABLE
                  ? command('lock', `Lock "${name}"? It becomes unusable until unlocked.`)
                  : undefined
              }
            >
              <Lock className="size-4" />
              Lock
              {CONTROL_AVAILABLE ? null : <ComingSoon />}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!CONTROL_AVAILABLE}
              onClick={() => (CONTROL_AVAILABLE ? command('unlock') : undefined)}
            >
              <LockKeyOpen className="size-4" />
              Unlock
              {CONTROL_AVAILABLE ? null : <ComingSoon />}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!CONTROL_AVAILABLE}
              onClick={() =>
                CONTROL_AVAILABLE
                  ? command('wipe', `Wipe "${name}"? This erases the device and CANNOT be undone.`)
                  : undefined
              }
              className={CONTROL_AVAILABLE ? 'text-destructive focus:text-destructive' : undefined}
            >
              <Trash className="size-4" />
              Wipe
              {CONTROL_AVAILABLE ? null : <ComingSoon />}
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

// The quiet uppercase "Coming soon" whisper shown on a gated control item.
function ComingSoon() {
  return (
    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
      Coming soon
    </span>
  );
}
