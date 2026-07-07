'use client';

import { ShieldSlash as ShieldX } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ErasureForm() {
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);

  async function erase() {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/erasure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject }),
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as {
        status?: string;
        erasedRows?: number;
        results?: { store: string; deleted: number }[];
        deferred?: string[];
      };
      const rows = data.erasedRows ?? 0;
      const stores = (data.results ?? []).filter((r) => r.deleted > 0).length;
      const deferred = data.deferred?.length ?? 0;
      const detail =
        `${rows} row${rows === 1 ? '' : 's'} erased across ${stores} store${stores === 1 ? '' : 's'}` +
        (deferred ? ` · ${deferred} store${deferred === 1 ? '' : 's'} deferred (see docs)` : '');
      if (data.status === 'partial') {
        toast.warning(`Partial erasure for ${subject} · ${detail}`);
      } else {
        toast.success(`Erased ${subject} · ${detail}`);
      }
      setSubject('');
    } catch {
      toast.error('Failed to erase subject');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        value={subject}
        placeholder="subject email or id…"
        onChange={(e) => setSubject(e.target.value)}
      />
      <Button variant="outline" onClick={erase} disabled={busy} className="shrink-0">
        <ShieldX className="size-4" />
        Erase subject
      </Button>
    </div>
  );
}
