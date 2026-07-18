// Curated in-module feature index for global search — the "and sub-pages" half of the Phase 1
// search DoD. Module search only matches a module's name/description, so an operator who searches
// for what they want to DO ("suppress noise", "egress", "re-baseline") finds nothing. This maps
// action/feature keywords to the destination that does it. PURE data + matcher (zero I/O), so it's
// unit-testable and cheap to extend. `moduleId` lets the route drop features whose module is
// disabled for the deployment.
import type { ModuleId } from '@/modules/registry';

export interface FeatureEntry {
  id: string;
  title: string; // what the feature is
  subtitle: string; // where it lives
  href: string; // deep link (route, optionally with query)
  moduleId: ModuleId; // owning module (for enablement filtering)
  keywords: string[]; // extra search terms beyond the title words
}

export const FEATURES: FeatureEntry[] = [
  {
    id: 'routing-leash',
    title: 'Model routing & cloud egress leash',
    subtitle: 'Control',
    href: '/governance',
    moduleId: 'control',
    keywords: [
      'routing',
      'egress',
      'leash',
      'cloud',
      'local',
      'block',
      'route',
      'where requests run',
    ],
  },
  {
    id: 'audit-log',
    title: 'Audit log & search',
    subtitle: 'Control',
    href: '/governance',
    moduleId: 'control',
    keywords: ['audit', 'trail', 'log', 'who did what', 'compliance record'],
  },
  {
    id: 'rbac',
    title: 'Users & roles (RBAC)',
    subtitle: 'Control',
    href: '/governance',
    moduleId: 'control',
    keywords: ['rbac', 'users', 'roles', 'permissions', 'access control'],
  },
  {
    id: 'siem-suppression',
    title: 'Suppression rules',
    subtitle: 'Security Events',
    href: '/insights/siem',
    moduleId: 'siem',
    keywords: ['suppress', 'suppression', 'mute', 'noise', 'ignore', 'filter events', 'scanner'],
  },
  {
    id: 'drift-baseline',
    title: 'Drift baseline & alert thresholds',
    subtitle: 'Drift',
    href: '/insights/drift',
    moduleId: 'drift',
    keywords: ['baseline', 'threshold', 'drift alert', 're-baseline', 'reset baseline'],
  },
  {
    id: 'connector-sync',
    title: 'Connectors — add, edit, sync',
    subtitle: 'Integrations',
    href: '/data/integrations',
    moduleId: 'integrations',
    keywords: ['connector', 'sync', 'ingest', 'data source', 'source system', 'add source'],
  },
  {
    id: 'agent-create',
    title: 'Create an agent (with tools)',
    subtitle: 'Apps',
    href: '/solutions/apps/new',
    moduleId: 'studio',
    keywords: ['create agent', 'new agent', 'agent tools', 'capabilities', 'author agent'],
  },
  {
    id: 'budgets',
    title: 'Budgets & virtual keys',
    subtitle: 'FinOps',
    href: '/insights/finops',
    moduleId: 'finops',
    keywords: ['budget', 'cost', 'spend', 'virtual key', 'chargeback', 'limit'],
  },
  {
    id: 'pii-masking',
    title: 'PII masking & guardrails',
    subtitle: 'Guardrails',
    href: '/governance/guardrails',
    moduleId: 'guardrails',
    keywords: ['pii', 'mask', 'redact', 'guardrail', 'presidio', 'sensitive data'],
  },
  {
    id: 'secrets-vault',
    title: 'Secrets vault',
    subtitle: 'Secrets',
    href: '/governance/secrets',
    moduleId: 'secrets',
    keywords: ['secret', 'vault', 'openbao', 'credentials', 'api key', 'kms'],
  },
  {
    id: 'policy-rules',
    title: 'Policy rules (ABAC / OPA)',
    subtitle: 'Policy',
    href: '/governance/policies/overview',
    moduleId: 'policy',
    keywords: ['policy', 'abac', 'opa', 'rego', 'deny', 'allow', 'rule'],
  },
  {
    id: 'evals-golden',
    title: 'Evals & golden sets',
    subtitle: 'Evals',
    href: '/solutions/quality/evaluators',
    moduleId: 'evals',
    keywords: ['eval', 'golden', 'test', 'llm-as-judge', 'quality', 'pass rate'],
  },
  {
    id: 'backups-run',
    title: 'Run & schedule backups',
    subtitle: 'Backups',
    href: '/operations/backups',
    moduleId: 'backups',
    keywords: ['backup', 'restore', 'snapshot', 'recovery', 'dr'],
  },
  {
    id: 'knowledge-upload',
    title: 'Upload knowledge (RAG)',
    subtitle: 'Knowledge',
    href: '/workspace/knowledge',
    moduleId: 'knowledge',
    keywords: ['knowledge', 'rag', 'upload doc', 'ingest document', 'brain'],
  },
];

/** Case-insensitive match of a query against a feature's title, subtitle, and keywords. */
export function matchFeatures(query: string, limit = 5): FeatureEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return FEATURES.filter((f) => {
    if (f.title.toLowerCase().includes(q)) return true;
    if (f.subtitle.toLowerCase().includes(q)) return true;
    return f.keywords.some((k) => k.includes(q) || q.includes(k));
  }).slice(0, limit);
}
