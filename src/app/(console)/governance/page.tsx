import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { ModuleCard, type ModuleLink } from '@/components/ModuleCard';
import { lastAccessReviewAt } from '@/lib/access-reviews-store';
import { reviewDueness } from '@/lib/access-review';
import { listDomains } from '@/lib/data-domains-store';
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
  const [policy, users, teams, audit, domains, lastReview] = await Promise.all([
    safeWithTimeout(() => getOrgPolicy(), 1200, null),
    safeWithTimeout(() => listUsers(orgId), 1200, null),
    safeWithTimeout(() => listTeams(orgId), 1200, null),
    safeWithTimeout(() => listAudit({ orgId, limit: 6 }), 1200, null),
    safeWithTimeout(() => listDomains(orgId), 1200, null),
    safeWithTimeout(() => lastAccessReviewAt(orgId), 1200, null),
  ]);

  // IS AN ACCESS REVIEW OWED? The artefact existed but nothing told anyone it was overdue, so the
  // only way to find out was to navigate to the review surface and read it.
  const due = reviewDueness(lastReview ?? null, new Date());

  // THE DPO's WORKLIST. Every data source we process without a recorded lawful basis is an
  // indefensible position, and it was invisible — there was nowhere in the console this count could
  // come from. It is stated as a count of gaps, not a reassuring percentage.
  const ungrounded = domains?.filter((d) => !d.lawfulBasis).length ?? null;

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
        label: 'Sources without a lawful basis',
        value: ungrounded == null ? 'Unavailable' : ungrounded.toLocaleString(),
        description:
          ungrounded == null
            ? 'Data domains did not respond.'
            : ungrounded === 0
              ? `Every one of ${domains?.length ?? 0} data sources records why we may process it.`
              : `Of ${domains?.length ?? 0} data sources, ${ungrounded} do not record why we are permitted to process them. Runs reading these are flagged.`,
        // Straight to the gaps, not to a page of 23 cards the reader has to scan.
        href: ungrounded ? '/data/domains?basis=missing' : '/data/domains',
        state: ungrounded == null ? 'attention' : ungrounded === 0 ? 'good' : 'attention',
      },
      {
        label: 'Access certified',
        value: lastReview
          ? lastReview.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Never',
        description: due.message,
        href: '/governance/access/review',
        state: due.due ? 'attention' : 'good',
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
  { title: 'Policies', href: '/governance/policies', description: 'Egress leash, data ceilings, and the access rules your work inherits.' },
  { title: 'Guardrails', href: '/governance/guardrails', description: 'PII, injection, and toxicity scanners applied on every governed run.' },
  { title: 'Secrets', href: '/governance/secrets', description: 'Vaulted connector + service credentials and dynamic database access.' },
  { title: 'Access', href: '/governance/access', description: 'People, machine clients, roles, sessions, and federation.' },
  { title: 'Teams', href: '/governance/teams', description: 'Delegated-access groups that scope pipelines + apps by member role.' },
  { title: 'Evidence', href: '/governance/evidence/audit', description: 'The audit trail, provenance, and exportable compliance evidence.' },
];
