import { Scales } from '@phosphor-icons/react/dist/ssr';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requireModuleForUser } from '@/lib/module-access';
import { listModules } from '@/lib/opa-policy';
import { listPolicyRules } from '@/lib/policy-rules';
import { readDecisions, readPolicyStatus } from '@/lib/policy-view';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Operator-facing labels for the policy-engine ids. The raw ids (`abac` / `opa`) are real internal
// adapter identifiers used for routing; they are never shown to a normal operator as our mechanism
// (the "never expose the engine" brand rule). Unknown ids fall back to the id itself.
const POLICY_ENGINE_LABEL: Record<string, string> = {
  abac: 'Built-in rules (attribute-based)',
  opa: 'Policy-as-code',
};
function policyEngineLabel(id: string): string {
  return POLICY_ENGINE_LABEL[id?.toLowerCase()] ?? 'Policy rules';
}

// Policy management + decisions read-back. Server component: reads the active policy set + OPA
// reachability, the console-owned policy rules, and the normalized recent decisions through the pure
// views. The rules table (add/edit/delete + push-to-OPA) is a client child; its nav lives in the URL.
export default async function PolicyPage() {
  await requireModuleForUser('policy');
  const orgId = await currentOrgId();
  const [status, decisions, rules, opaModules] = await Promise.all([
    readPolicyStatus(),
    readDecisions(),
    listPolicyRules(orgId),
    listModules(),
  ]);

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Scales className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Policy</h1>
              <p className="text-sm text-muted-foreground">
                Policy-as-code decisions — the active policy set, policy-engine reachability, and
                recent allow/deny evaluations.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
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
                <CardTitle className="text-base">Active policy set</CardTitle>
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
                    {status.policies.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {policyEngineLabel(p.id)}
                          {p.id === status.engine ? (
                            <Badge variant="secondary" className="ml-2">
                              active
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Policy authoring</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="abac">
                <TabsList>
                  <TabsTrigger value="abac">ABAC rules (default)</TabsTrigger>
                  <TabsTrigger value="templates">Starter templates</TabsTrigger>
                  <TabsTrigger value="rego">Policy-as-code modules (advanced)</TabsTrigger>
                </TabsList>
                <TabsContent value="templates" className="pt-4">
                  <PolicyTemplatesPanel />
                </TabsContent>
                <TabsContent value="abac" className="pt-4">
                  <Suspense
                    fallback={<p className="text-sm text-muted-foreground">Loading rules…</p>}
                  >
                    <PolicyRulesManager rules={rules} />
                  </Suspense>
                </TabsContent>
                <TabsContent value="rego" className="pt-4">
                  <Suspense
                    fallback={<p className="text-sm text-muted-foreground">Loading modules…</p>}
                  >
                    <RegoModulesManager
                      modules={opaModules.reachable ? opaModules.modules : []}
                      reachable={opaModules.reachable}
                      reason={opaModules.reachable ? undefined : opaModules.reason}
                    />
                  </Suspense>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent decisions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {decisions.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  No decision-log records yet. Turn on decision-log streaming in Settings to see
                  policy decisions here.
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
                    {decisions.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Badge variant={d.allow ? 'default' : 'destructive'}>{d.decision}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">{d.path || '—'}</TableCell>
                        <TableCell className="max-w-md truncate text-muted-foreground">
                          {d.input}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {policyEngineLabel(d.engine)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.timestamp || '—'}
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
