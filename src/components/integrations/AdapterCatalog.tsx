'use client';

import { Plugs, PlugsConnected } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CapabilityBinding } from '@/lib/adapters/registry';
import {
  ADAPTER_CATEGORIES,
  ALL_CATEGORY_ID,
  categoryCounts,
  filterByCategory,
  normalizeCategory,
} from '@/lib/adapters/categories';
import { cn } from '@/lib/utils';

const RENDER: Record<string, string> = {
  native: 'bg-primary/10 text-primary',
  headless: 'bg-muted text-muted-foreground',
  embed: 'bg-muted text-muted-foreground',
};

function healthLabel(
  healthy: boolean | undefined,
  configured: boolean | undefined,
): { text: string; cls: string } {
  if (healthy === undefined) return { text: 'n/a', cls: 'bg-muted text-muted-foreground' };
  if (healthy) return { text: 'reachable', cls: 'bg-primary/10 text-primary' };
  // healthy === false: distinguish "never wired up" (calm) from "wired but down" (real problem).
  if (configured === false) return { text: 'not configured', cls: 'bg-muted text-muted-foreground' };
  return { text: 'unreachable', cls: 'bg-amber-500/10 text-amber-600' };
}

// The adapter catalog — "Configure every underlying service." Given how many capability ports
// exist, a single flat grid is hard to scan, so the cards are grouped by function behind a scoped
// sub-nav. The active category lives in the URL (?cat=) so it's deep-linkable and Back-coherent;
// the default (no ?cat=) is "All". Every card keeps its swap-via config, live health, and the
// register action — this is organization, not removal.
export function AdapterCatalog({ bindings }: { bindings: CapabilityBinding[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = normalizeCategory(searchParams.get('cat'));
  const counts = categoryCounts(bindings);
  const shown = filterByCategory(bindings, active);

  // Build a ?cat= href preserving other params (there are none today, but stay correct if added).
  const hrefFor = (catId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (catId === ALL_CATEGORY_ID) params.delete('cat');
    else params.set('cat', catId);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Only surface tabs that actually have adapters, so the strip mirrors what's wired.
  const tabs = [
    { id: ALL_CATEGORY_ID, label: 'All' },
    ...ADAPTER_CATEGORIES.filter((c) => (counts[c.id] ?? 0) > 0).map((c) => ({
      id: c.id,
      label: c.label,
    })),
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Underlying services</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every capability port — the active adapter, what it can swap for, and whether it&apos;s
          reachable. Swap the implementation with one environment variable.
        </p>
      </div>

      {/* Mid-page category filter — a plain in-flow tab strip, NOT <SubNav> (the top-of-page band that
          bleeds to console edges; mid-page its -mt-6 pulls the emerald band over the content above). */}
      <div className="border-b border-border pb-2">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Adapter categories">
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <Link
                key={t.id}
                href={hrefFor(t.id)}
                scroll={false}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-muted-foreground/60">
                  {counts[t.id] ?? 0}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((b) => {
          const health = healthLabel(b.healthy, b.configured);
          const envKey = `OFFGRID_ADAPTER_${b.capability.toUpperCase()}`;
          const Icon = b.healthy ? PlugsConnected : Plugs;
          return (
            <Card key={b.capability} className="shadow-sm">
              <CardHeader className="space-y-0 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Icon className="size-5 text-primary" />
                    <CardTitle className="text-sm capitalize">{b.capability}</CardTitle>
                  </div>
                  <Badge variant="secondary" className={health.cls}>
                    {health.text}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">{b.active.vendor}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {b.active.license}
                  </Badge>
                  <Badge variant="secondary" className={RENDER[b.active.render] ?? ''}>
                    {b.active.render}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{b.active.description}</p>

                <div className="space-y-1.5 border-t border-border pt-3">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    Swap via
                  </span>
                  <code className="block rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                    {envKey}=&lt;adapter-id&gt;
                  </code>
                  {b.alternatives.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {b.alternatives.map((a) => (
                        <Badge key={a.id} variant="outline">
                          {a.id}
                          {a.status === 'planned' ? (
                            <span className="ml-1 text-muted-foreground/60">· planned</span>
                          ) : null}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">No alternatives.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
