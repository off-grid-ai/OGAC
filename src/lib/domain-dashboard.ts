import { CANONICAL_OWNERS, IA_SECTIONS, type IaSectionId } from '@/modules/ownership';

export type DomainDashboardId = Exclude<IaSectionId, 'home'>;

export interface DomainDashboardFact {
  label: string;
  value: string;
  description: string;
  href?: string;
  state?: 'neutral' | 'good' | 'attention';
}

export interface DomainDashboardActivity {
  id: string;
  label: string;
  detail: string;
  timestamp?: string;
  href: string;
}

export interface DomainDashboardModule {
  id: string;
  label: string;
  description: string;
  href: string;
}

export interface DomainDashboardModel {
  id: DomainDashboardId;
  title: string;
  purpose: string;
  summary: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  facts: readonly DomainDashboardFact[];
  activities: readonly DomainDashboardActivity[];
  modules: readonly DomainDashboardModule[];
}

interface DomainDefinition {
  summary: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
}

const DOMAIN_DEFINITIONS: Record<DomainDashboardId, DomainDefinition> = {
  work: {
    summary:
      'Use governed company context to do more of your work, without needing to understand the platform underneath it.',
    primaryAction: { label: 'Open chat', href: '/work/chat' },
    secondaryAction: { label: 'Browse projects', href: '/work/projects' },
  },
  solutions: {
    summary:
      'Codify important business processes into reusable AI apps, then prove and improve their value through every run.',
    primaryAction: { label: 'Build an app', href: '/solutions/apps/new' },
    secondaryAction: { label: 'Browse library', href: '/solutions/library' },
  },
  data: {
    summary:
      "Turn the organization's data and context into governed intelligence that every approved solution can reuse.",
    primaryAction: { label: 'Manage sources', href: '/data/sources' },
    secondaryAction: { label: 'Open catalog', href: '/data/catalog' },
  },
  runtime: {
    summary:
      'Give the organization reliable, private intelligence on infrastructure it controls, with cloud access only where policy permits it.',
    primaryAction: { label: 'Review models', href: '/runtime/models' },
    secondaryAction: { label: 'Manage pipelines', href: '/runtime/pipelines' },
  },
  governance: {
    summary:
      'Set organizational controls once so every app, model request, and data flow inherits them, with evidence for each decision.',
    primaryAction: { label: 'Review posture', href: '/governance/posture' },
    secondaryAction: { label: 'Open policies', href: '/governance/policies' },
  },
  insights: {
    summary:
      'Prove where AI makes work faster, better, or cheaper, and where quality, adoption, or ROI still needs attention.',
    primaryAction: { label: 'Review outcomes', href: '/insights/outcomes' },
    secondaryAction: { label: 'Inspect AI behavior', href: '/insights/ai' },
  },
  operations: {
    summary:
      'Keep the installed private AI cloud healthy and recoverable without assembling or operating a pile of separate tools.',
    primaryAction: { label: 'Open runs', href: '/operations/runs' },
    secondaryAction: { label: 'Check services', href: '/operations/services' },
  },
};

export const DOMAIN_DASHBOARD_IDS = Object.freeze(
  Object.keys(DOMAIN_DEFINITIONS) as DomainDashboardId[],
);

export function buildDomainDashboard(
  id: DomainDashboardId,
  input: {
    facts?: readonly (DomainDashboardFact | null | undefined)[];
    activities?: readonly (DomainDashboardActivity | null | undefined)[];
  } = {},
): DomainDashboardModel {
  const section = IA_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown dashboard domain: ${id}`);

  const definition = DOMAIN_DEFINITIONS[id];
  const modules = CANONICAL_OWNERS.filter(
    (owner) => owner.section === id && owner.placement === 'sidebar',
  ).map((owner) => ({
    id: owner.id,
    label: owner.label,
    description: owner.description,
    href: owner.route,
  }));

  return {
    id,
    title: section.label,
    purpose: section.purpose,
    summary: definition.summary,
    primaryAction: definition.primaryAction,
    secondaryAction: definition.secondaryAction,
    facts: (input.facts ?? []).filter((fact): fact is DomainDashboardFact => Boolean(fact)),
    activities: (input.activities ?? [])
      .filter((activity): activity is DomainDashboardActivity => Boolean(activity))
      .slice(0, 6),
    modules,
  };
}
