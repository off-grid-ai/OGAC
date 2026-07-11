'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { toggleMessage } from '@/lib/toast-messages';

export function KeyToggle({ id, enabled, label }: { id: string; enabled: boolean; label?: string }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/keys/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(toggleMessage(label, next, 'Key'));
      router.refresh();
    } catch {
      setOn(!next);
      toast.error('Failed to update key');
    } finally {
      setBusy(false);
    }
  }

  return <Switch checked={on} disabled={busy} onCheckedChange={toggle} />;
}
