import { Plugs, PlugsConnected } from '@phosphor-icons/react/dist/ssr';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { AddConnectorButton } from '@/components/integrations/AddConnectorButton';
import { CachePanel } from '@/components/integrations/CachePanel';
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
import { listConnectors, listTools } from '@/lib/store';

export const dynamic = 'force-dynamic';

const RENDER: Record<string, string> = {
  native: 'bg-primary/10 text-primary',
  headless: 'bg-muted text-muted-foreground',
  embed: 'bg-muted text-muted-foreground',
};

function healthLabel(healthy: boolean | undefined): { text: string; cls: string } {
  if (healthy === undefined) return { text: 'n/a', cls: 'bg-muted text-muted-foreground' };
  if (healthy) return { text: 'reachable', cls: 'bg-primary/10 text-primary' };
  return { text: 'unreachable', cls: 'bg-amber-500/10 text-amber-600' };
}

const CON_STATUS: Record<string, string> = {
  connected: 'bg-primary/10 text-primary',
  error: 'bg-destructive/10 text-destructive',
};

export default async function IntegrationsPage() {
  await requireModuleForUser('integrations');
  const org = await currentOrgId();
  const [bindings, connectors, tools] = await Promise.all([
    listBindings(true),
    listConnectors(org),
    listTools(org),
  ]);

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every underlying service is reached through a capability port — swap the implementation with
        one environment variable, no code change. This is the single place to see what&apos;s wired,
        whether it&apos;s reachable, and what you can swap it for.
      </p>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Connector directory</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Available connectors + their status. Register a custom MCP server or HTTP endpoint.
            </p>
          </div>
          <AddConnectorButton />
        </CardHeader>
        <CardContent>
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connectors yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-foreground">
                      {c.name}
                      {c.description ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {c.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.type}</TableCell>
                    <TableCell className="text-muted-foreground">{c.auth}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={CON_STATUS[c.status] ?? ''}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.custom ? (
                        <DeleteRowButton url={`/api/v1/admin/connectors/${c.id}`} label={c.name} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
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
                    <TableCell className="text-muted-foreground">{t.enabled ? 'yes' : 'no'}</TableCell>
                    <TableCell>
                      <ToolPolicySelect toolId={t.id} policy={t.policy} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CachePanel />

      <GatewayIntegrations />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {bindings.map((b) => {
          const health = healthLabel(b.healthy);
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
