'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { toggleMessage } from '@/lib/toast-messages';
import { Switch } from '@/components/ui/switch';

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/flags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: flagKey, enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(toggleMessage(flagKey, next, 'Flag'));
      router.refresh();
    } catch {
      setOn(!next);
      toast.error('Failed to update flag');
    } finally {
      setBusy(false);
    }
  }

  return <Switch checked={on} disabled={busy} onCheckedChange={toggle} />;
}
