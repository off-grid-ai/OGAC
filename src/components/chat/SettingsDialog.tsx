'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// Custom instructions — a per-user system prompt applied to every chat (ChatGPT parity).
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) {
      void fetch('/api/v1/chat/settings')
        .then((r) => (r.ok ? r.json() : { customInstructions: '' }))
        .then((d) => setValue(d.customInstructions ?? ''));
    }
  }, [open]);

  async function save() {
    await fetch('/api/v1/chat/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customInstructions: value }),
    });
    toast.success('Custom instructions saved');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Custom instructions</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Applied to every chat as a system prompt — how the model should respond to you.
          </Label>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            placeholder="e.g. Be concise. I'm an engineer — prefer code and bullet points over prose."
            className="text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
