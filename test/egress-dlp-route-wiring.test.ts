import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ROUTE_PATH = 'src/app/api/v1/chat/stream/route.ts';

test('chat cloud-egress DLP attributes every decision to the resolved tenant', () => {
  // A full POST requires live auth, tenant persistence, routing, guardrail, and provider boundaries.
  // Replacing those Off Grid modules would make this a mockist test, so this focused wiring contract
  // parses the production callsite instead. Root's live gate must still prove that the resulting
  // gateway.egress.dlp row appears in the non-default tenant's ledger.
  const source = readFileSync(ROUTE_PATH, 'utf8');
  const file = ts.createSourceFile(
    ROUTE_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let dlpContext: ts.ObjectLiteralExpression | null = null;
  const auditContextArguments: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'dlpCtx' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      dlpContext = node.initializer;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'egressDlpAuditEvent'
    ) {
      auditContextArguments.push(node.arguments[0]?.getText(file) ?? '');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  assert.ok(dlpContext, 'the cloud egress branch must construct one DLP audit context');
  const org = dlpContext.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText(file) === 'org',
  );
  assert.ok(org, 'the DLP audit context must carry an org');
  assert.equal(
    org.initializer.getText(file),
    'orgId',
    'gateway.egress.dlp decisions must use currentOrgId(), never DEFAULT_ORG',
  );
  assert.deepEqual(
    auditContextArguments,
    ['dlpCtx', 'dlpCtx'],
    'blocked and released cloud decisions must share the tenant-correct DLP context',
  );
});
