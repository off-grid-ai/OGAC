'use client';

import { BookmarkSimple, MagnifyingGlass, Plus, Sparkle } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  PROMPT_STARTERS,
  buildPromptPayload,
  groupStarters,
  searchStarters,
  type PromptStarter,
} from '@/lib/prompt-starters';
import { preview } from '@/lib/workspace-grid';

// Starter library panel for the Prompts module. A curated, searchable, grouped set of common
// reusable prompts. "Add to my prompts" writes through the EXISTING create path
// (POST /api/v1/prompts) — no new storage — then calls onAdded so the parent reloads its grid.
export function PromptStarterLibrary({ onAdded }: { onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const groups = useMemo(
    () => groupStarters(searchStarters([...PROMPT_STARTERS], q)),
    [q],
  );

  async function add(starter: PromptStarter) {
    setAdding(starter.id);
    try {
      const res = await fetch('/api/v1/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPromptPayload(starter)),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`Added "${starter.title}" to your prompts`);
      onAdded();
    } catch {
      toast.error('Could not add starter');
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkle className="size-4 text-primary" />
        <h2 className="font-mono text-sm font-semibold">Starter library</h2>
        <p className="text-xs text-muted-foreground">
          Curated, ready-to-use prompts. One click adds a copy to your prompts above — then edit it
          however you like.
        </p>
        <div className="relative ml-auto w-full max-w-xs">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search starters…"
            className="pl-8 font-mono"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No starters match “{q}”.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map(({ group, items }) => (
            <section key={group} className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h3>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((s) => (
                  <StarterCard
                    key={s.id}
                    starter={s}
                    busy={adding === s.id}
                    onAdd={() => add(s)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StarterCard({
  starter,
  busy,
  onAdd,
}: {
  starter: PromptStarter;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
          <BookmarkSimple className="size-3.5" />
        </span>
        <span className="truncate font-mono text-sm font-medium">{starter.title}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{starter.description}</p>
        <p className="line-clamp-3 whitespace-pre-wrap rounded border border-border/60 bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {preview(starter.content, 200)}
        </p>
        {starter.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {starter.tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-auto border-t border-border pt-2.5">
          <Button size="xs" className="gap-1" onClick={onAdd} disabled={busy}>
            <Plus className="size-3" /> {busy ? 'Adding…' : 'Add to my prompts'}
          </Button>
        </div>
      </div>
    </div>
  );
}
