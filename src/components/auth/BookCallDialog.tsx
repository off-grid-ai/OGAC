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

// Reused on the signin page (default "Book a call", outline) AND the marketing landing (label
// "Book a demo", primary emerald CTA) — one booking dialog, no duplication. The trigger's label +
// styling are props; the cal.com embed is identical.
export function BookCallDialog({
  label = 'Book a call',
  variant = 'outline',
  size = 'sm',
  className = 'w-full',
}: {
  label?: string;
  variant?: 'outline' | 'default';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
} = {}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Book a call with Off Grid AI</DialogTitle>
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
