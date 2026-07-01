'use client';

import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';

interface Probe {
  url: string;
  reachable: boolean;
  frameable: boolean;
  status?: number;
  reason?: string;
}

// Embed guard: probes an OSS tool server-side (reachability + X-Frame-Options / CSP) before
// framing it. If framing is blocked or the target is down, falls back to an "open in new tab" link
// instead of rendering a blank iframe.
// eslint-disable-next-line complexity
export function EmbedGuard({
  url,
  title,
  height = 640,
}: {
  url?: string;
  title: string;
  height?: number;
}) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!url) {
      setChecked(true);
      return;
    }
    let live = true;
    fetch(`/api/v1/admin/embeds?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((p: Probe) => {
        if (live) setProbe(p);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setChecked(true);
      });
    return () => {
      live = false;
    };
  }, [url]);

  if (!url) {
    return (
      <p className="text-xs text-muted-foreground">
        {title} not configured — set its embed URL to surface it here.
      </p>
    );
  }

  if (!checked) {
    return <p className="text-xs text-muted-foreground">Checking {title}…</p>;
  }

  const fallback = (note: string) => (
    <div className="flex flex-col items-start gap-2 rounded-md border border-border bg-muted/40 p-4">
      <p className="text-xs text-muted-foreground">
        {title} can&apos;t be embedded here ({note}).
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <ArrowSquareOut className="size-4" />
        Open {title} in a new tab
      </a>
    </div>
  );

  if (!probe?.reachable) return fallback(probe?.reason ?? 'unreachable');
  if (!probe.frameable) return fallback(probe.reason ?? 'framing blocked');

  return (
    <iframe
      src={url}
      title={title}
      style={{ height }}
      className="w-full rounded-md border border-border"
    />
  );
}
