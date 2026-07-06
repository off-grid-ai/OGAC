import { AdapterCatalog } from '@/components/integrations/AdapterCatalog';
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

      <AdapterCatalog bindings={bindings} />
    </div>
  );
}
