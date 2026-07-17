import { Cube } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Suspense } from 'react';
import { RunCodePanel } from '@/components/sandbox/RunCodePanel';
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
import { getFlags, getSandbox } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import {
  type ExecStatus,
  normalizeSandbox,
  readSandboxStatus,
  type SandboxView,
} from '@/lib/sandbox-view';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT: Record<ExecStatus, string> = {
  ok: 'bg-primary/10 text-primary',
  failed: 'bg-destructive/10 text-destructive',
  timeout: 'bg-amber-500/10 text-amber-600',
  refused: 'text-muted-foreground',
};

const FILTERS: { id: 'all' | ExecStatus; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'ok', label: 'ok' },
  { id: 'failed', label: 'failed' },
  { id: 'timeout', label: 'timeout' },
  { id: 'refused', label: 'refused' },
];

function isExecStatus(v: string | undefined): v is ExecStatus {
  return v === 'ok' || v === 'failed' || v === 'timeout' || v === 'refused';
}

// Backend ids that actually execute code (mirrors the sandbox GET route). Anything else refuses.
const EXEC_CAPABLE_BACKENDS = new Set(['docker', 'firecracker', 'e2b']);

// Friendly capability labels for the active backend — operators see WHAT the sandbox does
// (isolation strength), never the underlying execution-engine project name. Falls back to a
// generic label. The raw backend id stays the internal key (routing, exec gating).
const BACKEND_LABEL: Record<string, string> = {
  none: 'No-exec (safe default)',
  docker: 'Container isolation',
  firecracker: 'Hardware-isolated microVM',
  e2b: 'Managed secure sandbox',
};
function backendLabel(id: string): string {
  return BACKEND_LABEL[id] ?? 'Secure sandbox';
}

export default async function SandboxPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ status?: string }>;
}>) {
  await requireModuleForUser('sandbox');
  const { status: statusParam } = await searchParams;
  const filter: 'all' | ExecStatus = isExecStatus(statusParam) ? statusParam : 'all';

  const { data, error } = await readSandboxStatus(getSandbox());
  const view: SandboxView = normalizeSandbox(data, []);
  const runs = filter === 'all' ? view.runs : view.runs.filter((r) => r.status === filter);

  // Double gate for the Run Code panel: flag ON + exec-capable backend. Surfaced honestly.
  const execEnabled = await getFlags().isEnabled('agent-code-exec', false);
  const execCapable = EXEC_CAPABLE_BACKENDS.has(view.backend);

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Cube className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Sandbox</h1>
              <p className="text-sm text-muted-foreground">
                Code-execution isolation for agent-authored code — the active backend, its
                reachability, and recent runs. On-prem, gated by the agent-code-exec flag.
              </p>
            </div>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Backend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary" className="font-medium text-foreground">
                  {backendLabel(view.backend)}
                </Badge>
                <Badge variant="secondary" className="text-muted-foreground">
                  {view.license}
                </Badge>
                {view.execDisabled ? (
                  <Badge variant="secondary" className="text-muted-foreground">
                    exec disabled
                  </Badge>
                ) : null}
                <Badge
                  variant="secondary"
                  className={
                    view.reachable
                      ? 'bg-primary/10 text-primary'
                      : 'bg-destructive/10 text-destructive'
                  }
                >
                  {view.reachable ? 'reachable' : 'unreachable'}
                </Badge>
              </div>
              {view.description ? (
                <p className="text-sm text-muted-foreground">{view.description}</p>
              ) : null}
              {error ? (
                <p className="text-xs text-destructive">status read failed: {error}</p>
              ) : null}
            </CardContent>
          </Card>

          <Suspense fallback={null}>
            <RunCodePanel
              execEnabled={execEnabled}
              execCapable={execCapable}
              backend={view.backend}
            />
          </Suspense>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Recent runs</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {view.total} total · {view.counts.ok} ok · {view.counts.failed} failed ·{' '}
                  {view.counts.timeout} timeout · {view.counts.refused} refused
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <Link
                    key={f.id}
                    href={f.id === 'all' ? '/build/sandbox' : `/build/sandbox?status=${f.id}`}
                    scroll={false}
                  >
                    <Badge
                      variant="secondary"
                      className={
                        filter === f.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                      }
                    >
                      {f.label}
                    </Badge>
                  </Link>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Engine</TableHead>
                      <TableHead>Language</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">
                          {r.createdAt ? r.createdAt.slice(0, 19).replace('T', ' ') : '—'}
                        </TableCell>
                        <TableCell className="font-medium text-foreground">{r.engine}</TableCell>
                        <TableCell className="text-muted-foreground">{r.language}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={STATUS_VARIANT[r.status]}>
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.exitCode ?? '—'}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {r.durationMs === null ? '—' : `${r.durationMs} ms`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}
