'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';

export function RoutingRuleToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/routing/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setOn(!next);
      toast.error('Failed to update rule');
    } finally {
      setBusy(false);
    }
  }

  return <Switch checked={on} disabled={busy} onCheckedChange={toggle} />;
}
