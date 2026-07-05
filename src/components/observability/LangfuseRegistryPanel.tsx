'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DatasetRow, PromptRow, SessionRow } from '@/lib/langfuse';

// Which Langfuse registry sub-view is showing. URL-driven via ?lfReg so the position is deep-linkable
// and Back-coherent (nav-in-URL, not client state). Defaults to prompts.
const TABS = ['prompts', 'datasets', 'sessions'] as const;
export type RegistryTab = (typeof TABS)[number];
export const DEFAULT_REGISTRY_TAB: RegistryTab = 'prompts';

export function resolveRegistryTab(raw: string | undefined): RegistryTab {
  return TABS.includes(raw as RegistryTab) ? (raw as RegistryTab) : DEFAULT_REGISTRY_TAB;
}

function fmtTs(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function TabBar({ active, counts }: { active: RegistryTab; counts: Record<RegistryTab, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = useCallback(
    (t: RegistryTab) => {
      const next = new URLSearchParams(params.toString());
      next.set('lfReg', t);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => set(t)}
          className={`rounded-md border px-2 py-1 capitalize ${
            active === t ? 'border-primary text-primary' : 'border-border text-muted-foreground'
          }`}
        >
          {t} ({counts[t]})
        </button>
      ))}
    </div>
  );
}

export function LangfuseRegistryPanel({
  configured,
  prompts,
  datasets,
  sessions,
  error,
  tab,
}: {
  configured: boolean;
  prompts: PromptRow[];
  datasets: DatasetRow[];
  sessions: SessionRow[];
  error?: string;
  tab: RegistryTab;
}) {
  const counts: Record<RegistryTab, number> = {
    prompts: prompts.length,
    datasets: datasets.length,
    sessions: sessions.length,
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Langfuse registry — prompts · datasets · sessions</CardTitle>
            <p className="text-xs text-muted-foreground">
              Read back from Langfuse&apos;s public API (v2/prompts, datasets, sessions). Read-only view.
            </p>
          </div>
          <TabBar active={tab} counts={counts} />
        </div>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            Langfuse read-back not configured — set OFFGRID_LANGFUSE_URL + the project keys to pull the
            prompt registry, datasets, and sessions.
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Langfuse unreachable: {error}
          </p>
        ) : tab === 'prompts' ? (
          prompts.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead>Versions</TableHead>
                  <TableHead>Labels</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prompts.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="font-mono text-xs text-foreground">{p.name}</TableCell>
                    <TableCell className="text-foreground">
                      {p.latestVersion === null ? '—' : `v${p.latestVersion}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.versionCount}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {p.labels.length ? (
                          p.labels.map((l) => (
                            <Badge key={l} variant="outline">
                              {l}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtTs(p.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No prompts in the Langfuse registry.
            </p>
          )
        ) : tab === 'datasets' ? (
          datasets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dataset</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.name}>
                    <TableCell className="font-mono text-xs text-foreground">{d.name}</TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {d.description || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtTs(d.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No Langfuse datasets.</p>
          )
        ) : sessions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Traces</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs text-foreground">{s.id}</TableCell>
                  <TableCell className="text-muted-foreground">{s.traces}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {fmtTs(s.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No Langfuse sessions.</p>
        )}
      </CardContent>
    </Card>
  );
}
