'use client';

import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface MemoryItem {
  id: string;
  fact: string;
  source: string;
}

// Per-user memory manager — durable facts the assistant remembers across chats. Auto-extracted
// facts and manual additions live together; the user can add or forget any of them.
export function MemoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [draft, setDraft] = useState('');

  const refresh = () =>
    fetch('/api/v1/chat/memory')
      .then((r) => (r.ok ? r.json() : { memory: [] }))
      .then((d) => setItems(d.memory ?? []));

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function add() {
    const fact = draft.trim();
    if (!fact) return;
    setDraft('');
    await fetch('/api/v1/chat/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fact }),
    });
    await refresh();
  }

  async function remove(id: string) {
    await fetch('/api/v1/chat/memory', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Memory</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Facts the assistant remembers about you across conversations. Injected into every chat.
        </p>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Add a fact to remember…"
          />
          <Button size="sm" onClick={add} className="gap-1.5">
            <Plus className="size-4" /> Add
          </Button>
        </div>
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {items.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Nothing remembered yet.</p>
          ) : null}
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border border-border p-2">
              <span className="min-w-0 flex-1 text-sm">{m.fact}</span>
              <span className="text-[10px] text-muted-foreground">{m.source}</span>
              <Trash
                onClick={() => remove(m.id)}
                className="size-4 cursor-pointer text-muted-foreground hover:text-destructive"
              />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
