import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PolicyRulesManager } from '@/components/policy/PolicyRulesManager';
import { PolicyTemplatesPanel } from '@/components/policy/PolicyTemplatesPanel';
import { RegoModulesManager } from '@/components/policy/RegoModulesManager';
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
import { requireModuleForUser } from '@/lib/module-access';
import { listModules } from '@/lib/opa-policy';
import { listPolicyRules } from '@/lib/policy-rules';
import { readDecisions, readPolicyStatus } from '@/lib/policy-view';
import { currentOrgId } from '@/lib/tenancy';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

const POLICY_ENGINE_LABEL: Readonly<Record<string, string>> = {
  abac: 'Built-in rules (attribute-based)',
  opa: 'Policy-as-code',
};

function policyEngineLabel(id: string): string {
  return POLICY_ENGINE_LABEL[id?.toLowerCase()] ?? 'Policy rules';
}

export default async function PolicyDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('policy');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(
    contextualModule('governance-policies'),
    rawDestination,
  );
  if (!destination) notFound();

  if (destination.id === 'overview') return <PolicyOverview />;
  if (destination.id === 'templates') return <PolicyTemplatesPanel />;

  if (destination.id === 'rules') {
    const orgId = await currentOrgId();
    const rules = await listPolicyRules(orgId);
    return (
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading rules…</p>}>
        <PolicyRulesManager rules={rules} />
      </Suspense>
    );
  }

  if (destination.id === 'modules') {
    const modules = await listModules();
    return (
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading modules…</p>}>
        <RegoModulesManager
          modules={modules.reachable ? modules.modules : []}
          reachable={modules.reachable}
          reason={modules.reachable ? undefined : modules.reason}
        />
      </Suspense>
    );
  }

  return <PolicyDecisions />;
}

async function PolicyOverview() {
  const status = await readPolicyStatus();
  return (
    <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            Policy engine
            <Badge variant={status.reachable ? 'default' : 'destructive'}>
              {status.reachable ? 'reachable' : 'unreachable'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Active engine:{' '}
            <span className="text-foreground">{policyEngineLabel(status.engine)}</span>
          </p>
          <p>
            Policy adapters:{' '}
            <span className="font-mono text-foreground">{status.policies.length}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Active policy set</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy engine</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    {policyEngineLabel(policy.id)}
                    {policy.id === status.engine ? (
                      <Badge variant="secondary" className="ml-2">
                        active
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{policy.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

async function PolicyDecisions() {
  const decisions = await readDecisions();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent decisions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {decisions.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No decision-log records yet. Turn on decision-log streaming in Settings to see policy
            decisions here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Decision</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Engine</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisions.map((decision) => (
                <TableRow key={decision.id}>
                  <TableCell>
                    <Badge variant={decision.allow ? 'default' : 'destructive'}>
                      {decision.decision}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{decision.path || '—'}</TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {decision.input}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {policyEngineLabel(decision.engine)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {decision.timestamp || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
