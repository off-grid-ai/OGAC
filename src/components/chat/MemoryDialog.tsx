'use client';

import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        <SheetHeader>
          <SheetTitle className="text-sm">Memory</SheetTitle>
          <SheetDescription className="text-xs">
            Facts the assistant remembers about you across conversations. Injected into every chat.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-6">
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
          <div className="space-y-1.5">
            {items.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nothing remembered yet.
              </p>
            ) : null}
            {items.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-border p-2"
              >
                <span className="min-w-0 flex-1 text-sm">{m.fact}</span>
                <span className="text-[10px] text-muted-foreground">{m.source}</span>
                <Trash
                  onClick={() => remove(m.id)}
                  className="size-4 cursor-pointer text-muted-foreground hover:text-destructive"
                />
              </div>
            ))}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
