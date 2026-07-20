import { AdapterCatalog } from '@/components/integrations/AdapterCatalog';
import { AddConnectorButton } from '@/components/integrations/AddConnectorButton';
import { CachePanel } from '@/components/integrations/CachePanel';
import { ConnectorCard } from '@/components/integrations/ConnectorCard';
import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';
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
import { formatRelativeTime } from '@/lib/operations-destinations';
import { listConnectors, listIngestJobs, listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function AdaptersDestination() {
  const orgId = await currentOrgId();
  const [bindings, connectors, tools, jobs] = await Promise.all([
    listBindings(true),
    listConnectors(orgId),
    listTools(orgId),
    listIngestJobs(orgId, 8),
  ]);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        See what is wired, whether it is reachable, and which implementation can replace it. Each
        capability stays behind its adapter port.
      </p>

      <ConnectorCatalog />

      <section className="space-y-3">
        <div className="flex flex-row items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Connector directory</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Register, edit, inspect, and remove MCP servers or HTTP endpoints.
            </p>
          </div>
          <AddConnectorButton />
        </div>
        {connectors.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No connectors yet. Register an MCP server or HTTP endpoint to add one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={{
                  id: connector.id,
                  name: connector.name,
                  type: connector.type,
                  status: connector.status,
                  lastSync: formatRelativeTime(connector.lastSync),
                  endpoint: connector.endpoint,
                  auth: connector.auth,
                  description: connector.description,
                  custom: connector.custom,
                }}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <CachePanel />

        <Card className="h-full shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Tool action policy</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose whether each connector action runs, waits for approval, or is refused.
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
                    {tools.map((tool) => (
                      <TableRow key={tool.id}>
                        <TableCell className="font-medium text-foreground">{tool.name}</TableCell>
                        <TableCell className="text-muted-foreground">{tool.type}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {tool.enabled ? 'yes' : 'no'}
                        </TableCell>
                        <TableCell>
                          <ToolPolicySelect toolId={tool.id} policy={tool.policy} />
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
                The latest connector sync jobs and the records each one pulled.
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
                    {jobs.map((job) => {
                      let statusClass = 'bg-muted text-muted-foreground';
                      if (job.status === 'completed') statusClass = 'bg-primary/10 text-primary';
                      else if (job.status === 'failed') {
                        statusClass = 'bg-destructive/10 text-destructive';
                      }
                      return (
                        <TableRow key={job.id}>
                          <TableCell className="font-medium text-foreground">
                            {job.connectorName}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={statusClass}>
                              {job.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {job.records.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {formatRelativeTime(job.startedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
