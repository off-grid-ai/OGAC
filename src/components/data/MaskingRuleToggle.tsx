'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';

export function MaskingRuleToggle({ id, initial }: { id: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);

  async function toggle(next: boolean) {
    setOn(next);
    const res = await fetch(`/api/v1/admin/masking-rules/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      toast.success(`Rule ${next ? 'enabled' : 'disabled'}`);
      router.refresh();
    } else {
      setOn(!next);
      toast.error('Failed to update rule');
    }
  }

  return <Switch checked={on} onCheckedChange={toggle} aria-label="Toggle masking rule" />;
}
