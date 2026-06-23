'use client';

import { ArrowSquareOut, CaretDown, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

// A Tier-3 embed: the tool's own UI in an SSO'd iframe. Lazily mounted (only on expand) so we
// don't load every dashboard at once. SSO is handled by the deployment's auth proxy in front of
// the tool — the iframe just points at the configured URL.
export function EmbedFrame({ title, url }: { title: string; url?: string }) {
  const [open, setOpen] = useState(false);

  if (!url) {
    return <span className="text-xs text-muted-foreground">URL not configured</span>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          {open ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
          {open ? 'Hide' : 'Open'} {title}
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={url} target="_blank" rel="noreferrer">
            <ArrowSquareOut className="size-4" />
            New tab
          </a>
        </Button>
      </div>
      {open ? (
        <iframe
          title={title}
          src={url}
          className="h-[70vh] w-full rounded-md border border-border bg-[#ffffff]"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      ) : null}
    </div>
  );
}
