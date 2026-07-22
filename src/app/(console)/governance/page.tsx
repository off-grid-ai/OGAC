import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { ModuleCard, type ModuleLink } from '@/components/ModuleCard';
import { PageFrame } from '@/components/PageFrame';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { getOrgPolicy, listAudit, listUsers } from '@/lib/store';
import { listTeams } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

// Governance section OVERVIEW — the home of the controls plane. Headline posture facts (each a way IN
// to its module) + the most recent audit trail, over the section's auto-linked sub-modules (policies,
// guardrails, secrets, access, teams, evidence). Honest: a source that doesn't answer shows
// "Unavailable" (attention), never a fabricated number.
export default async function GovernancePage() {
  const orgId = await currentOrgId();
  const [policy, users, teams, audit] = await Promise.all([
    safeWithTimeout(() => getOrgPolicy(), 1200, null),
    safeWithTimeout(() => listUsers(orgId), 1200, null),
    safeWithTimeout(() => listTeams(orgId), 1200, null),
    safeWithTimeout(() => listAudit({ orgId, limit: 6 }), 1200, null),
  ]);

  const model = buildDomainDashboard('governance', {
    facts: [
      {
        label: 'Cloud egress',
        value: policy ? (policy.egressAllowed ? 'Allowed' : 'Leashed (on-prem)') : 'Unavailable',
        description: policy
          ? 'Org egress posture — when leashed, cloud routes are blocked everywhere.'
          : 'Policy did not respond.',
        href: '/governance/policies',
        state: policy ? (policy.egressAllowed ? 'neutral' : 'good') : 'attention',
      },
      {
        label: 'People with access',
        value: users ? users.length.toLocaleString() : 'Unavailable',
        description: users ? 'Identities that can sign in to the console.' : 'Users did not respond.',
        href: '/governance/access',
        state: users ? 'neutral' : 'attention',
      },
      {
        label: 'Teams',
        value: teams ? teams.length.toLocaleString() : 'Unavailable',
        description: teams
          ? 'Delegated-access groups scoping pipelines + apps by member role.'
          : 'Teams did not respond.',
        href: '/governance/teams',
        state: teams ? 'neutral' : 'attention',
      },
    ],
    activities: (audit ?? []).map((a) => {
      const r = a as unknown as Record<string, unknown>;
      const id = String(r.id ?? r.ts ?? Math.random());
      const action = String(r.action ?? r.tool ?? r.model ?? 'event');
      const outcome = r.outcome == null ? '' : ` · ${String(r.outcome)}`;
      const ts = r.ts == null ? undefined : String(r.ts).slice(0, 10);
      return {
        id,
        label: action,
        detail: `${r.keyId ?? r.deviceId ?? 'system'}${outcome}`,
        timestamp: ts,
        href: '/governance/evidence/audit',
      };
    }),
  });

  return (
    <PageFrame>
      <div className="space-y-6">
        <DomainDashboard model={model} />
        <div className="border-t border-border pt-6">
          <h2 className="text-base font-normal text-foreground">Manage controls</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set policy, guardrails, secrets, access, and evidence — inherited everywhere they apply.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GOVERNANCE_MODULES.map((m) => (
            <ModuleCard key={m.href} {...m} />
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

const GOVERNANCE_MODULES: ModuleLink[] = [
  { title: 'Policies', href: '/governance/policies', description: 'Egress leash, data ceilings, and the OPA authz rules pipelines inherit.' },
  { title: 'Guardrails', href: '/governance/guardrails', description: 'PII, injection, and toxicity scanners applied on every governed run.' },
  { title: 'Secrets', href: '/governance/secrets', description: 'Vaulted connector + service credentials and dynamic database access.' },
  { title: 'Access', href: '/governance/access', description: 'People, machine clients, roles, sessions, and federation.' },
  { title: 'Teams', href: '/governance/teams', description: 'Delegated-access groups that scope pipelines + apps by member role.' },
  { title: 'Evidence', href: '/governance/evidence/audit', description: 'The audit trail, provenance, and exportable compliance evidence.' },
];
