'use client';

import { FloppyDisk as Save } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Org-wide system prompt editor. Persists the single org instruction injected as the
// highest-precedence system block into every chat (before per-user custom instructions).
export function OrgInstructionsEditor({ initial }: Readonly<{ initial: string }>) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch('/api/v1/admin/org-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemPrompt: value }),
    });
    setBusy(false);
    if (res.ok) toast.success('Org instructions saved');
    else toast.error('Failed to save');
  }

  return (
    <div className="space-y-3">
      <Textarea
        rows={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Always answer in British English. Never disclose internal financials. Cite sources."
      />
      <Button size="sm" onClick={save} disabled={busy}>
        <Save className="size-4" />
        Save org instructions
      </Button>
    </div>
  );
}
