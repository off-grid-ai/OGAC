'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DatasetRow, PromptRow, SessionRow } from '@/lib/langfuse';
import {
  DEFAULT_REGISTRY_TAB,
  type RegistryTab,
  REGISTRY_TABS,
  resolveRegistryTab,
} from '@/lib/langfuse-registry';

// Tab types/helpers now live in the server-safe @/lib/langfuse-registry so the server page can import
// resolveRegistryTab without crossing the RSC boundary. Re-exported for existing importers.
export { DEFAULT_REGISTRY_TAB, type RegistryTab, resolveRegistryTab };
const TABS = REGISTRY_TABS;

function fmtTs(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function TabBar({ active, counts }: Readonly<{ active: RegistryTab; counts: Record<RegistryTab, number> }>) {
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
}: Readonly<{
  configured: boolean;
  prompts: PromptRow[];
  datasets: DatasetRow[];
  sessions: SessionRow[];
  error?: string;
  tab: RegistryTab;
}>) {
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
            <CardTitle className="text-sm">Prompt registry — prompts · datasets · sessions</CardTitle>
            <p className="text-xs text-muted-foreground">
              Read back from the trace/prompt registry (prompts, datasets, sessions). Read-only view.
            </p>
          </div>
          <TabBar active={tab} counts={counts} />
        </div>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            Trace/prompt registry read-back not configured — set the tracing-store URL + project keys
            to pull the prompt registry, datasets, and sessions.
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Trace/prompt registry unreachable: {error}
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
              No prompts in the trace/prompt registry.
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
            <p className="py-8 text-center text-sm text-muted-foreground">No datasets in the registry.</p>
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
          <p className="py-8 text-center text-sm text-muted-foreground">No sessions in the registry.</p>
        )}
      </CardContent>
    </Card>
  );
}
