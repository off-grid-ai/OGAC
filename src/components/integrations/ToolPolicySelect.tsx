'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

const OPTIONS: { value: string; label: string }[] = [
  { value: 'allow', label: 'Always allow' },
  { value: 'approval', label: 'Needs approval' },
  { value: 'blocked', label: 'Blocked' },
];

// Admin-editable per-tool action policy. PATCHes the tool and enforces it in chat-tools execution.
export function ToolPolicySelect({ toolId, policy }: { toolId: string; policy: string }) {
  const router = useRouter();
  const [value, setValue] = useState(policy);
  const [busy, setBusy] = useState(false);

  async function update(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    const res = await fetch(`/api/v1/admin/tools/${toolId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policy: next }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Policy updated');
      router.refresh();
    } else {
      setValue(prev);
      toast.error('Failed to update policy');
    }
  }

  return (
    <select
      aria-label="Action policy"
      value={value}
      disabled={busy}
      onChange={(e) => update(e.target.value)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
