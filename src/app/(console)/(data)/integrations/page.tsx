import { Plugs, PlugsConnected } from '@phosphor-icons/react/dist/ssr';
import { AddConnectorButton } from '@/components/integrations/AddConnectorButton';
import { CachePanel } from '@/components/integrations/CachePanel';
import { ConnectorCard } from '@/components/integrations/ConnectorCard';
import { GatewayIntegrations } from '@/components/integrations/GatewayIntegrations';
import { ToolPolicySelect } from '@/components/integrations/ToolPolicySelect';
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
import { listBindings } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { listConnectors, listIngestJobs, listTools } from '@/lib/store';

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const dynamic = 'force-dynamic';

const RENDER: Record<string, string> = {
  native: 'bg-primary/10 text-primary',
  headless: 'bg-muted text-muted-foreground',
  embed: 'bg-muted text-muted-foreground',
};

function healthLabel(healthy: boolean | undefined, configured: boolean | undefined): { text: string; cls: string } {
  if (healthy === undefined) return { text: 'n/a', cls: 'bg-muted text-muted-foreground' };
  if (healthy) return { text: 'reachable', cls: 'bg-primary/10 text-primary' };
  // healthy === false: distinguish "never wired up" (calm) from "wired but down" (real problem).
  if (configured === false) return { text: 'not configured', cls: 'bg-muted text-muted-foreground' };
  return { text: 'unreachable', cls: 'bg-amber-500/10 text-amber-600' };
}

export default async function IntegrationsPage() {
  await requireModuleForUser('integrations');
  const org = await currentOrgId();
  const [bindings, connectors, tools, jobs] = await Promise.all([
    listBindings(true),
    listConnectors(org),
    listTools(org),
    listIngestJobs(8),
  ]);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every underlying service is reached through a capability port — swap the implementation with
        one environment variable, no code change. This is the single place to see what&apos;s wired,
        whether it&apos;s reachable, and what you can swap it for.
      </p>

      {/* Connector directory — a card grid, not a flat list. Density scales with width:
          2-up on tablets, 3-up on lg, 4-up on xl. Each card keeps the full row actions. */}
      <section className="space-y-3">
        <div className="flex flex-row items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Connector directory</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Available connectors + their status. Register a custom MCP server or HTTP endpoint.
            </p>
          </div>
          <AddConnectorButton />
        </div>
        {connectors.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent>
              <p className="text-sm text-muted-foreground">No connectors yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {connectors.map((c) => (
              <ConnectorCard
                key={c.id}
                connector={{
                  id: c.id,
                  name: c.name,
                  type: c.type,
                  status: c.status,
                  lastSync: relTime(c.lastSync),
                  endpoint: c.endpoint,
                  auth: c.auth,
                  description: c.description,
                  custom: c.custom,
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Smaller/stat sections share the row on desktop instead of stacking full-width:
          cache stats + tool policy side by side on lg; ingest runs joins on xl. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <CachePanel />

        <Card className="h-full shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Tool action policy</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Per-connector policy enforced in chat: <b>Always allow</b> runs immediately,{' '}
              <b>Needs approval</b> routes through the human gate, <b>Blocked</b> refuses execution.
            </p>
          </CardHeader>
          <CardContent>
            {tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No chat tools registered yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead className="w-44">Policy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">{t.type}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {t.enabled ? 'yes' : 'no'}
                        </TableCell>
                        <TableCell>
                          <ToolPolicySelect toolId={t.id} policy={t.policy} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {jobs.length > 0 ? (
          <Card className="h-full shadow-sm lg:col-span-2 xl:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm">Recent ingest runs</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The latest sync jobs — what each connector pulled and when.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Connector</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium text-foreground">
                          {j.connectorName}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              j.status === 'completed'
                                ? 'bg-primary/10 text-primary'
                                : j.status === 'failed'
                                  ? 'bg-destructive/10 text-destructive'
                                  : 'bg-muted text-muted-foreground'
                            }
                          >
                            {j.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {j.records.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {relTime(j.startedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <GatewayIntegrations />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {bindings.map((b) => {
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
    </div>
  );
}
