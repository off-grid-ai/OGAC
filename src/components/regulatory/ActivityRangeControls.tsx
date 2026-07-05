'use client';

import { DownloadSimple as Download } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// URL-driven date-range picker + export links for the DPO activity report. State lives in the URL
// (?from&to), so the range is deep-linkable/shareable and Back is coherent — no local navigational
// state. The server page re-reads searchParams and re-aggregates from the real ledger.
export function ActivityRangeControls({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const setRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      const p = new URLSearchParams(params.toString());
      if (nextFrom) p.set('from', nextFrom);
      else p.delete('from');
      if (nextTo) p.set('to', nextTo);
      else p.delete('to');
      const qs = p.toString();
      router.replace(qs ? `?${qs}` : '?', { scroll: false });
    },
    [params, router],
  );

  const exportHref = (format: string) => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('format', format);
    return `/api/v1/admin/compliance/activity/export?${p.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="dpia-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="dpia-from"
          type="date"
          value={from}
          onChange={(e) => setRange(e.target.value, to)}
          className="w-40"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dpia-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="dpia-to"
          type="date"
          value={to}
          onChange={(e) => setRange(from, e.target.value)}
          className="w-40"
        />
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={exportHref('csv')}>
            <Download className="size-4" />
            CSV
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref('json')}>
            <Download className="size-4" />
            JSON
          </a>
        </Button>
        <Button asChild size="sm">
          <a href={exportHref('md')}>
            <Download className="size-4" />
            DPIA pack
          </a>
        </Button>
      </div>
    </div>
  );
}
