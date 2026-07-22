// Canonical URL migrations for the 2026 information architecture. Plain ESM lets Next config and
// Node tests consume this exact contract. A `children` rule carries nested detail routes intact.
export const IA_ROUTE_MIGRATIONS = Object.freeze([
  { from: '/chat', to: '/work/chat', children: true },
  { from: '/projects', to: '/work/projects', children: true },
  { from: '/prompts', to: '/work/prompts', children: true },
  { from: '/artifacts', to: '/work/artifacts', children: true },
  { from: '/storage', to: '/work/files', children: true },
  { from: '/knowledge', to: '/data/knowledge', children: true },
  { from: '/studio', to: '/solutions/apps', children: true },
  { from: '/apps/runs', to: '/operations/runs', children: true },
  { from: '/apps/reports', to: '/insights/outcomes', children: true },
  { from: '/apps', to: '/solutions/apps', children: true },
  { from: '/agents', to: '/solutions/agents', children: true },
  { from: '/agent-runs', to: '/operations/runs', children: true },
  { from: '/tools', to: '/solutions/tools', children: true },
  { from: '/evals', to: '/solutions/quality', children: true },
  { from: '/sandbox', to: '/solutions/test', children: true },
  { from: '/pipelines', to: '/runtime/pipelines', children: true },
  { from: '/gateway', to: '/runtime/models' },
  { from: '/gateways', to: '/runtime/gateways', children: true },
  { from: '/services', to: '/operations/services', children: true },
  { from: '/fleet', to: '/operations/devices', children: true },
  { from: '/edge', to: '/operations/edge', children: true },
  { from: '/connectors', to: '/data/sources', children: true },
  { from: '/integrations', to: '/operations/configuration/adapters', children: true },
  { from: '/tool-catalog', to: '/solutions/tools', children: true },
  { from: '/data-domains', to: '/data/domains', children: true },
  { from: '/retrieval', to: '/data/knowledge', children: true },
  { from: '/lineage', to: '/data/lineage', children: true },
  { from: '/control', to: '/governance/posture', children: true },
  { from: '/policy', to: '/governance/policies', children: true },
  { from: '/access', to: '/governance/access', children: true },
  { from: '/teams', to: '/governance/teams', children: true },
  { from: '/guardrails', to: '/governance/guardrails', children: true },
  { from: '/secrets', to: '/governance/secrets', children: true },
  { from: '/regulatory', to: '/governance/trust/regulatory', children: true },
  { from: '/trust', to: '/governance/trust', children: true },
  { from: '/provenance', to: '/governance/evidence/provenance', children: true },
  { from: '/exporters', to: '/governance/evidence/export', children: true },
  { from: '/observability', to: '/insights/ai', children: true },
  { from: '/analytics', to: '/insights/usage', children: true },
  { from: '/roi', to: '/insights/outcomes', children: true },
  { from: '/platform-health', to: '/operations/health', children: true },
  { from: '/drift', to: '/insights/quality/drift', children: true },
  { from: '/finops', to: '/runtime/api-budgets', children: true },
  { from: '/accounting', to: '/insights/cost', children: true },
  { from: '/reports', to: '/governance/trust/reports', children: true },
  { from: '/siem', to: '/governance/evidence/security', children: true },
  { from: '/audit', to: '/governance/evidence/audit', children: true },
  { from: '/admin', to: '/operations/admin', children: true },
  { from: '/config', to: '/operations/configuration', children: true },
  { from: '/backups', to: '/operations/backups', children: true },
  { from: '/api-docs', to: '/runtime/api', children: true },

  { from: '/workspace/chat', to: '/work/chat', children: true },
  { from: '/workspace/projects', to: '/work/projects', children: true },
  { from: '/workspace/prompts', to: '/work/prompts', children: true },
  { from: '/workspace/artifacts', to: '/work/artifacts', children: true },
  { from: '/workspace/storage', to: '/work/files', children: true },
  { from: '/workspace/knowledge', to: '/data/knowledge', children: true },
  { from: '/build/studio', to: '/solutions/apps', children: true },
  { from: '/build/apps/runs', to: '/operations/runs', children: true },
  { from: '/build/apps/reports', to: '/insights/outcomes', children: true },
  { from: '/build/apps', to: '/solutions/apps', children: true },
  { from: '/build/agents', to: '/solutions/agents', children: true },
  { from: '/build/agent-runs', to: '/operations/runs', children: true },
  { from: '/build/tools', to: '/solutions/tools', children: true },
  { from: '/build/review', to: '/solutions/reviews', children: true },
  { from: '/build/evals', to: '/solutions/quality', children: true },
  { from: '/build/sandbox', to: '/solutions/test', children: true },
  { from: '/build/pipelines', to: '/runtime/pipelines', children: true },
  { from: '/gateway/ai', to: '/runtime/models', children: true },
  { from: '/gateway/registry', to: '/runtime/gateways', children: true },
  { from: '/gateway/services', to: '/operations/services', children: true },
  { from: '/gateway/fleet', to: '/operations/devices', children: true },
  { from: '/gateway/edge', to: '/operations/edge', children: true },
  { from: '/data/integrations', to: '/operations/configuration/adapters', children: true },
  { from: '/data/tool-catalog', to: '/solutions/tools', children: true },
  { from: '/data/query', to: '/data/warehouse/query', children: true },
  { from: '/data/governance', to: '/data/catalog/governance', children: true },
  { from: '/data/pipelines', to: '/data/flows/replication', children: true },
  { from: '/data/etl', to: '/data/flows/orchestration', children: true },
  { from: '/data/retrieval', to: '/data/knowledge/indexes', children: true },
  // NOTE: no `/governance` → sub-route redirect — /governance renders its own section OVERVIEW page.
  { from: '/governance/policy', to: '/governance/policies', children: true },
  { from: '/governance/provenance', to: '/governance/evidence/provenance', children: true },
  { from: '/governance/exporters', to: '/governance/evidence/export', children: true },
  { from: '/governance/regulatory', to: '/governance/trust/regulatory', children: true },
  { from: '/governance/reports', to: '/governance/trust/reports', children: true },
  // NOTE: no `/insights` → sub-route redirect — /insights renders its own section OVERVIEW page.
  { from: '/insights/copilot', to: '/insights/ai/copilot', children: true },
  { from: '/insights/evals', to: '/insights/quality/evals', children: true },
  { from: '/insights/platform', to: '/operations/health', children: true },
  { from: '/insights/analytics', to: '/insights/usage', children: true },
  { from: '/insights/drift', to: '/insights/quality/drift', children: true },
  { from: '/insights/roi', to: '/insights/outcomes', children: true },
  { from: '/insights/finops', to: '/runtime/api-budgets', children: true },
  { from: '/insights/accounting', to: '/insights/cost', children: true },
  { from: '/insights/reports', to: '/governance/trust/reports', children: true },
  { from: '/insights/siem', to: '/governance/evidence/security', children: true },
  { from: '/insights/audit', to: '/governance/evidence/audit', children: true },
  { from: '/operations/config', to: '/operations/configuration', children: true },
  { from: '/operations/api-docs', to: '/runtime/api', children: true },
  { from: '/operations/messaging', to: '/operations/configuration/messaging', children: true },
]);

export function nextRedirects(migrations = IA_ROUTE_MIGRATIONS) {
  return migrations.flatMap(({ from, to, children }) => {
    const rules = [{ source: from, destination: to, permanent: true }];
    if (children)
      rules.push({ source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true });
    return rules;
  });
}

export function canonicalPath(pathname, migrations = IA_ROUTE_MIGRATIONS) {
  const match = migrations
    .filter(
      ({ from, children }) => pathname === from || (children && pathname.startsWith(`${from}/`)),
    )
    .sort((a, b) => b.from.length - a.from.length)[0];
  return match ? `${match.to}${pathname.slice(match.from.length)}` : pathname;
}
