'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { noteDocumentName } from '@/lib/knowledge-note';

// FOUNDER FEEDBACK (2026-07-31): "this can't look ugly like this. use the side panel."
//
// The paste-text composer was rendered INLINE inside the Knowledge card — a title field, a six-row
// textarea and two buttons crammed into a third-width column, pushing the token meter and the document
// list down the page. Pasting a policy clause needs room; a 300px column is the wrong place for it.
//
// One component, used by BOTH the project knowledge panel and the org collection panel, so the two
// surfaces cannot drift into different composers again.
export function KnowledgeTextSheet({
  open,
  onOpenChange,
  target,
  busy,
  onSave,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the text is being added to — named in the header so the panel says where it lands. */
  target: string;
  busy: boolean;
  /** Returns true when the save succeeded, so the panel closes only on success. */
  onSave: (name: string, text: string) => Promise<boolean>;
}>) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');

  async function save() {
    const body = text.trim();
    if (!body) return;
    if (await onSave(noteDocumentName(body, title), body)) {
      setTitle('');
      setText('');
      onOpenChange(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-2xl flex-col gap-0 p-0">
        <SheetHeader className="gap-1 border-b border-border px-4 py-3 pr-10">
          <SheetTitle className="text-sm">Add text to {target}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Paste a policy clause, a circular, an email or a decision. It is chunked and embedded on this
            deployment, exactly like an uploaded file, and answers can cite it.
          </p>
        </SheetHeader>
        <SheetBody className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
          <Input
            value={title}
            placeholder="Title (optional — taken from the first line)"
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* The textarea takes the panel's remaining height: this is the one thing the user is here to
              do, and a tall field is the difference between pasting a clause and fighting a box. */}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the text…"
            className="min-h-0 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed"
          />
          <div className="flex shrink-0 items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {text.trim() ? `${text.trim().length.toLocaleString()} characters` : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={busy || !text.trim()}>
                {busy ? 'Embedding…' : 'Add to knowledge'}
              </Button>
            </div>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
