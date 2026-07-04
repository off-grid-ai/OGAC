'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// "Book a call" → opens the cal.com booking widget inline in a modal. Uses cal.com's iframe embed
// (?embed=true) rather than their JS snippet, so no third-party script loads — the auth-page CSP
// only needs frame-src for cal.com (see next.config.mjs), script-src stays 'self'. The iframe is
// mounted only once the dialog opens, so a sign-in visitor pays nothing until they ask to book.
const CAL_EMBED =
  'https://cal.com/mohammed-ali-chherawalla-jlvdhw/discovery-off-grid-ai-console-provit?embed=true&theme=auto';

export function BookCallDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          Book a call
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Book a call with Off Grid</DialogTitle>
        </DialogHeader>
        {open ? (
          <iframe
            title="Book a call"
            src={CAL_EMBED}
            className="h-[70vh] w-full rounded-b-lg"
            loading="lazy"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
