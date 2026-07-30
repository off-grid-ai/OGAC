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
}: Readonly<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
}>) {
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
        {/* SheetContent carries p-0, so nothing inside inherits padding. Padded locally rather than by
            changing SheetContent, which every other sheet in the app also uses. */}
        <SheetHeader className="gap-1 border-b border-border px-4 py-3 pr-10">
          <SheetTitle className="text-sm">Memory</SheetTitle>
          <SheetDescription className="text-xs leading-snug">
            Facts the assistant remembers across your chats.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-3 px-4 py-3">
          {/* Heights matched explicitly (h-9 both) — the input and button rendered at different heights, which
              reads as broken before anyone reads the words. No autoFocus: it left a permanent focus ring that
              looked like a validation error on a field the user had not touched. */}
          <div className="flex items-center gap-2">
            <Input
              className="h-9 min-w-0 flex-1 text-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Add a fact to remember…"
            />
            <Button size="sm" onClick={add} disabled={!draft.trim()} className="h-9 shrink-0 gap-1.5">
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <div className="space-y-1.5">
            {items.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">Nothing remembered yet.</p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Add a fact above and it is included in every chat.
                </p>
              </div>
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
