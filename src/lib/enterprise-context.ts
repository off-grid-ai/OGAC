// Server-side assembly for the Enterprise Context & Permission Resolver.
//
// Existing stores and policy owners resolve facts; this adapter only translates those facts into
// the frozen, safe resolver contract. It never returns connector endpoints/auth, tool endpoints, or
// hidden/cross-tenant resource identities.

import { ACTION_DESCRIPTORS, type ActionId } from '@/lib/action-contract';
import { isCompatibleCrmActionConnector } from '@/lib/action-connector-compatibility';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { callerFromSession } from '@/lib/app-access-caller';
import type { AppAccessCaller } from '@/lib/app-access-policy';
import { appToolCatalog } from '@/lib/app-tools';
import { getApp, listApps } from '@/lib/apps-store';
import { listDomains } from '@/lib/data-domains-store';
import {
  resolveEnterpriseContext,
  type EnterpriseAuthorizationFact,
  type EnterpriseCatalogSlice,
  type EnterpriseContextResolution,
  type EnterpriseContextResolverInput,
  type EnterpriseIntentDecision,
  type EnterpriseResourceCandidate,
} from '@/lib/enterprise-context-resolver';
import { isModuleEnabled } from '@/lib/modules';
import { listPipelines, type PipelineView } from '@/lib/pipelines';
import { resolveEffectivePermissions } from '@/lib/role-permissions';
import { listConnectors, listTools, type Connector, type Tool } from '@/lib/store';
import { canActOnTeamEntity } from '@/lib/team-access';
import { listMembershipsForUser, listTeams } from '@/lib/teams';
import type { Membership } from '@/lib/teams-policy';
import { primitiveCatalog } from '@/lib/tool-primitives';
import { decideAdminGate } from '@/lib/viewer-policy';
import type { ModuleId } from '@/modules/registry';

type Permissions = Awaited<ReturnType<typeof resolveEffectivePermissions>>;
type App = NonNullable<Awaited<ReturnType<typeof getApp>>>;
type Team = Awaited<ReturnType<typeof listTeams>>[number];

export interface EnterpriseContextActor {
  userId: string;
  role?: string;
  principalKind?: 'user' | 'machine';
}

export interface EnterpriseContextRequest {
  orgId: string;
  requestedOrgId?: string | null;
  actor: EnterpriseContextActor;
  appId?: string | null;
  evaluatedAt?: string;
  env?: Record<string, string | undefined>;
}

/** I/O ports only. Tests may fake these uncontrollable boundaries while keeping all Off Grid logic real. */
export interface EnterpriseContextSources {
  resolvePermissions(role: string | undefined, orgId: string): Promise<Permissions>;
  listMemberships(userId: string, orgId: string): Promise<Membership[]>;
  listTeams(orgId: string): Promise<Team[]>;
  listDomains(orgId: string): ReturnType<typeof listDomains>;
  listConnectors(orgId: string): Promise<Connector[]>;
  listTools(orgId: string): Promise<Tool[]>;
  listApps(orgId: string): ReturnType<typeof listApps>;
  getApp(id: string, orgId: string): ReturnType<typeof getApp>;
  listPipelines(orgId: string): Promise<PipelineView[]>;
  resolveCaller(actor: EnterpriseContextActor, orgId: string): Promise<AppAccessCaller>;
  appAccess(
    args: Parameters<typeof enforceAppAccessWithSharing>[0],
  ): ReturnType<typeof enforceAppAccessWithSharing>;
}

const defaultSources: EnterpriseContextSources = {
  resolvePermissions: resolveEffectivePermissions,
  listMemberships: listMembershipsForUser,
  listTeams,
  listDomains,
  listConnectors,
  listTools,
  listApps,
  getApp,
  listPipelines,
  resolveCaller: (actor, orgId) =>
    callerFromSession({ user: { email: actor.userId, role: actor.role } }, orgId),
  appAccess: enforceAppAccessWithSharing,
};

type Settled<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(load: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await load() };
  } catch {
    return { ok: false };
  }
}

function explanation(
  source: EnterpriseCatalogSlice['source'],
  reasonCode: string,
  reason: string,
  remedyHref?: string,
) {
  return { source, reasonCode, reason, ...(remedyHref ? { remedyHref } : {}) };
}

function slice(
  id: string,
  label: string,
  status: EnterpriseCatalogSlice['status'],
  source: EnterpriseCatalogSlice['source'],
  reasonCode: string,
  reason: string,
  remedyHref?: string,
): EnterpriseCatalogSlice {
  return { id, label, status, ...explanation(source, reasonCode, reason, remedyHref) };
}

function moduleVisible(permissions: Settled<Permissions>, moduleId: ModuleId): boolean {
  return permissions.ok && permissions.value.modules.has(moduleId);
}

function authorizationFromIntent(decision: EnterpriseIntentDecision): EnterpriseAuthorizationFact {
  return {
    status: decision.status,
    source: decision.source,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    ...(decision.remedyHref ? { remedyHref: decision.remedyHref } : {}),
  };
}

function identityFrom(
  request: EnterpriseContextRequest,
  permissions: Settled<Permissions>,
  memberships: Settled<Membership[]>,
  teams: Settled<Team[]>,
) {
  const teamById = new Map((teams.ok ? teams.value : []).map((team) => [team.id, team]));
  const actorTeams = (memberships.ok ? memberships.value : [])
    .map((membership) => teamById.get(membership.teamId))
    .filter((team): team is Team => Boolean(team));
  return {
    actorId: request.actor.userId,
    principalKind: request.actor.principalKind ?? 'user',
    role: permissions.ok ? permissions.value.role : (request.actor.role ?? 'viewer'),
    baseRole: permissions.ok ? permissions.value.baseRole : 'viewer',
    departments: [
      ...new Set(actorTeams.map((team) => team.department).filter((v): v is string => Boolean(v))),
    ],
    teams: actorTeams.map((team) => team.name),
  } satisfies EnterpriseContextResolverInput['actor'];
}

function registeredToolCandidates(
  tools: Tool[],
  orgId: string,
  visible: boolean,
  selection: EnterpriseIntentDecision,
): EnterpriseResourceCandidate[] {
  return tools.map((tool) => ({
    ref: `tool:${tool.id}`,
    sliceId: 'capabilities',
    kind: 'capability',
    label: tool.name,
    description: tool.description || `${tool.type} tool`,
    managementHref: `/solutions/tools/registry/${encodeURIComponent(tool.id)}`,
    scopeSummary: 'Registered organization tool',
    orgId,
    visibility: {
      status: visible ? 'visible' : 'hidden',
      ...explanation(
        'module-access',
        visible ? 'tools-visible' : 'tools-hidden',
        visible
          ? 'Your role may view registered tools.'
          : 'Registered tools are hidden for this role.',
      ),
    },
    availability: tool.enabled
      ? {
          status: 'available',
          ...explanation('catalog', 'tool-enabled', 'This registered tool is enabled.'),
        }
      : {
          status: 'unavailable',
          ...explanation(
            'catalog',
            'tool-disabled',
            'This registered tool is turned off.',
            '/solutions/tools/registry',
          ),
        },
    authorization: authorizationFromIntent(selection),
    constraints:
      tool.policy === 'blocked'
        ? [
            {
              status: 'denied',
              ...explanation(
                'action-policy',
                'tool-blocked',
                'Organization policy blocks this tool.',
                '/solutions/tools/registry',
              ),
            } as const,
          ]
        : tool.policy === 'approval'
          ? [
              {
                status: 'approval-required',
                ...explanation(
                  'action-policy',
                  'tool-approval-required',
                  'A person must approve use of this tool.',
                ),
              } as const,
            ]
          : [],
  }));
}

function primitiveCandidates(
  env: Record<string, string | undefined>,
  orgId: string,
  visible: boolean,
  selection: EnterpriseIntentDecision,
): EnterpriseResourceCandidate[] {
  return primitiveCatalog(env).map((primitive) => ({
    ref: primitive.ref,
    sliceId: 'capabilities',
    kind: 'capability',
    label: primitive.name,
    description: primitive.description,
    managementHref: '/solutions/tools/registry',
    scopeSummary: primitive.reachesInternet
      ? 'May reach the public internet'
      : 'Runs inside the organization',
    orgId,
    visibility: {
      status: visible ? 'visible' : 'hidden',
      ...explanation(
        'module-access',
        visible ? 'primitives-visible' : 'primitives-hidden',
        visible ? 'Your role may view built-in tools.' : 'Built-in tools are hidden for this role.',
      ),
    },
    availability: primitive.enabled
      ? {
          status: 'available',
          ...explanation('deployment', 'primitive-enabled', 'This built-in tool is enabled.'),
        }
      : {
          status: 'unavailable',
          ...explanation(
            'deployment',
            'primitive-disabled',
            primitive.airgapNote,
            '/solutions/tools/registry',
          ),
        },
    authorization: authorizationFromIntent(selection),
  }));
}

async function appToolCandidates(
  apps: App[],
  request: EnterpriseContextRequest,
  visible: boolean,
  selection: EnterpriseIntentDecision,
  caller: Settled<AppAccessCaller>,
  appAccess: EnterpriseContextSources['appAccess'],
): Promise<{ resources: EnterpriseResourceCandidate[]; accessComplete: boolean }> {
  const outcomes = await Promise.all(
    appToolCatalog(apps, request.appId ?? '').map(async (entry) => {
      const app = apps.find((candidate) => candidate.id === entry.id)!;
      const access = caller.ok
        ? await settle(() =>
            appAccess({
              appId: app.id,
              orgId: request.orgId,
              ownerId: app.ownerId,
              caller: caller.value,
              action: 'run',
            }),
          )
        : ({ ok: false } as const);
      return {
        accessComplete: access.ok,
        candidate: {
          ref: entry.ref,
          sliceId: 'capabilities',
          kind: 'capability',
          label: entry.name,
          description: entry.description,
          managementHref: `/solutions/apps/${encodeURIComponent(entry.id)}`,
          scopeSummary: 'Published organization App',
          orgId: request.orgId,
          visibility: {
            status: visible && access.ok && access.value.allow ? 'visible' : 'hidden',
            ...explanation(
              'app-sharing',
              access.ok && access.value.allow ? 'app-shared' : 'app-hidden',
              access.ok && access.value.allow
                ? access.value.reason
                : 'This App is not shared with you.',
            ),
          },
          availability: entry.cyclic
            ? {
                status: 'unavailable',
                ...explanation('catalog', 'app-cycle', 'Selecting this App would create a loop.'),
              }
            : {
                status: 'available',
                ...explanation('catalog', 'app-published', 'This published App can be reused.'),
              },
          authorization: authorizationFromIntent(selection),
          constraints:
            access.ok && access.value.allow
              ? []
              : [
                  {
                    status: 'denied',
                    ...explanation(
                      'app-access',
                      'app-run-denied',
                      access.ok ? access.value.reason : 'App access could not be verified.',
                    ),
                  },
                ],
        } satisfies EnterpriseResourceCandidate,
      };
    }),
  );
  return {
    resources: outcomes.map((outcome) => outcome.candidate),
    accessComplete: outcomes.every((outcome) => outcome.accessComplete),
  };
}

function dataCandidates(
  domains: Awaited<ReturnType<typeof listDomains>>,
  connectors: Settled<Connector[]>,
  request: EnterpriseContextRequest,
  visible: boolean,
  selection: EnterpriseIntentDecision,
): EnterpriseResourceCandidate[] {
  const connectorIds = new Set(
    (connectors.ok ? connectors.value : []).map((connector) => connector.id),
  );
  return domains.map((domain) => {
    const connectorAvailable = connectors.ok && connectorIds.has(domain.connectorId);
    return {
      ref: `data:${domain.id}`,
      sliceId: 'data',
      kind: 'data',
      label: domain.label,
      description: domain.resource
        ? `Organization data from ${domain.resource}`
        : 'Organization data domain',
      managementHref: `/data/domains/${encodeURIComponent(domain.id)}`,
      scopeSummary: domain.aliases.length
        ? `Also known as ${domain.aliases.join(', ')}`
        : 'Declared organization data',
      orgId: domain.orgId,
      visibility: {
        status: visible ? 'visible' : 'hidden',
        ...explanation(
          'module-access',
          visible ? 'data-visible' : 'data-hidden',
          visible
            ? 'Your role may view organization data domains.'
            : 'Data domains are hidden for this role.',
        ),
      },
      availability: connectorAvailable
        ? {
            status: 'available',
            ...explanation(
              'org-context',
              'connector-resolved',
              'Its declared organization connection is available.',
            ),
          }
        : {
            status: 'unavailable',
            ...explanation(
              'org-context',
              connectors.ok ? 'connector-missing' : 'connector-status-unknown',
              connectors.ok
                ? 'Its declared organization connection is missing.'
                : 'Connection availability could not be checked.',
              '/data/sources',
            ),
          },
      authorization: authorizationFromIntent(selection),
    } satisfies EnterpriseResourceCandidate;
  });
}

function pipelineCandidates(
  pipelines: PipelineView[],
  memberships: Settled<Membership[]>,
  request: EnterpriseContextRequest,
  baseRole: string,
  visible: boolean,
  selection: EnterpriseIntentDecision,
): EnterpriseResourceCandidate[] {
  const actor = {
    email: request.actor.userId,
    isAdmin: baseRole === 'admin',
    isApprover: baseRole === 'approver',
  };
  return pipelines.map((pipeline) => {
    const access = canActOnTeamEntity(
      actor,
      pipeline,
      memberships.ok ? memberships.value : [],
      'view',
    );
    return {
      ref: `pipeline:${pipeline.id}`,
      sliceId: 'pipelines',
      kind: 'capability',
      label: pipeline.name,
      description: pipeline.description || 'Governed model-access pipeline',
      managementHref: `/runtime/pipelines/${encodeURIComponent(pipeline.id)}`,
      scopeSummary: `${pipeline.status} · version ${pipeline.version}`,
      orgId: pipeline.orgId,
      visibility: {
        status: visible && access.allow ? 'visible' : 'hidden',
        ...explanation(
          'team-access',
          access.allow ? 'pipeline-visible' : 'pipeline-hidden',
          access.reason,
        ),
      },
      availability:
        pipeline.status === 'published'
          ? {
              status: 'available',
              ...explanation(
                'pipeline',
                'pipeline-published',
                'This governed pipeline is published.',
              ),
            }
          : {
              status: 'unavailable',
              ...explanation(
                'pipeline',
                'pipeline-not-published',
                'This pipeline must be published before an App can use it.',
                `/runtime/pipelines/${encodeURIComponent(pipeline.id)}`,
              ),
            },
      authorization: authorizationFromIntent(selection),
    } satisfies EnterpriseResourceCandidate;
  });
}

function actionCandidates(
  connectors: Connector[],
  request: EnterpriseContextRequest,
  visible: boolean,
  eligiblePriorHumanSteps: readonly { ref: string; label: string }[],
  configuration: EnterpriseIntentDecision,
): EnterpriseResourceCandidate[] {
  const compatible = connectors.some(isCompatibleCrmActionConnector);
  return (Object.keys(ACTION_DESCRIPTORS) as ActionId[]).map((actionId) => {
    const descriptor = ACTION_DESCRIPTORS[actionId];
    return {
      ref: `action:${actionId}`,
      sliceId: 'actions',
      kind: 'action',
      label: descriptor.label,
      description: `${descriptor.effect === 'create' ? 'Create' : 'Update'} an allowlisted record in ${descriptor.system}.`,
      managementHref: '/solutions/apps',
      scopeSummary: `${descriptor.system} · maker-checker approval`,
      orgId: request.orgId,
      visibility: {
        status: visible ? 'visible' : 'hidden',
        ...explanation(
          'module-access',
          visible ? 'actions-visible' : 'actions-hidden',
          visible
            ? 'Your role may configure governed actions.'
            : 'Governed actions are hidden for this role.',
        ),
      },
      availability: compatible
        ? {
            status: 'available',
            ...explanation(
              'catalog',
              'crm-connector-compatible',
              'A compatible on-prem CRM connection is available.',
            ),
          }
        : {
            status: 'unavailable',
            ...explanation(
              'catalog',
              'crm-connector-required',
              'Add an on-prem REST CRM connection before selecting this action.',
              '/data/sources',
            ),
          },
      authorization: authorizationFromIntent(configuration),
      constraints: [
        {
          status: 'approval-required',
          ...explanation(
            'action-policy',
            'maker-checker-required',
            'A different person must approve this action before it can change CRM.',
          ),
        },
      ],
      action: {
        connectorCompatibility: compatible ? 'compatible' : 'incompatible',
        approvalRequired: true,
        eligiblePriorHumanSteps,
        impactSummary: `${descriptor.effect === 'create' ? 'Creates one' : 'Updates one'} allowlisted ${descriptor.system} record.`,
        egressSummary: 'Requires a verified on-prem enterprise connection.',
      },
    } satisfies EnterpriseResourceCandidate;
  });
}

function intentDecision(
  intent: EnterpriseIntentDecision['intent'],
  permissions: Settled<Permissions>,
  actorRole: string | undefined,
  requiredModules: ModuleId[],
  method: 'POST' | 'PATCH',
  appEditAllowed: boolean | null,
): EnterpriseIntentDecision {
  if (!permissions.ok) {
    return {
      intent,
      status: 'denied',
      ...explanation(
        'module-access',
        'permissions-unavailable',
        'Your permissions could not be verified. Try again.',
        '/solutions/apps',
      ),
    };
  }
  const missing = requiredModules.find(
    (moduleId) => !permissions.value.modules.has(moduleId) || !isModuleEnabled(moduleId),
  );
  if (missing) {
    return {
      intent,
      status: 'denied',
      ...explanation(
        'module-access',
        'capability-unavailable',
        'A required organization capability is not available to your role.',
        '/operations/services',
      ),
    };
  }
  // Builder writes are enforced by requireAdmin, which evaluates the raw session role. Keep this
  // projection on that same role instead of granting a custom role based on its inherited baseline.
  const gate = decideAdminGate(actorRole, method);
  if (gate !== 'allow') {
    return {
      intent,
      status: 'denied',
      ...explanation(
        'module-access',
        gate === 'forbid-viewer-write' ? 'read-only-role' : 'admin-required',
        gate === 'forbid-viewer-write'
          ? 'This account can explore the Builder but cannot make changes.'
          : 'Apps are currently changed through an administrator-only surface.',
        '/solutions/apps',
      ),
    };
  }
  if (appEditAllowed === false && (intent === 'build.edit' || intent === 'publish')) {
    return {
      intent,
      status: 'denied',
      ...explanation(
        'app-access',
        'app-edit-denied',
        'This App is not shared with you for editing.',
        '/solutions/apps',
      ),
    };
  }
  return {
    intent,
    status: 'allowed',
    ...explanation('module-access', 'intent-allowed', 'Your current role may perform this step.'),
  };
}

/** Resolve the safe Builder context while isolating each independently owned source failure. */
export async function getEnterpriseContext(
  request: EnterpriseContextRequest,
  sources: EnterpriseContextSources = defaultSources,
): Promise<EnterpriseContextResolution> {
  const [
    permissions,
    memberships,
    teams,
    domains,
    connectors,
    tools,
    apps,
    pipelines,
    requestedApp,
    caller,
  ] = await Promise.all([
    settle(() => sources.resolvePermissions(request.actor.role, request.orgId)),
    settle(() => sources.listMemberships(request.actor.userId, request.orgId)),
    settle(() => sources.listTeams(request.orgId)),
    settle(() => sources.listDomains(request.orgId)),
    settle(() => sources.listConnectors(request.orgId)),
    settle(() => sources.listTools(request.orgId)),
    settle(() => sources.listApps(request.orgId)),
    settle(() => sources.listPipelines(request.orgId)),
    request.appId
      ? settle(() => sources.getApp(request.appId!, request.orgId))
      : Promise.resolve({ ok: true, value: null } as const),
    settle(() => sources.resolveCaller(request.actor, request.orgId)),
  ]);

  const studioVisible = moduleVisible(permissions, 'studio');
  const toolsVisible = moduleVisible(permissions, 'tools');
  const dataVisible = moduleVisible(permissions, 'data');
  const pipelinesVisible = moduleVisible(permissions, 'pipelines');
  const resources: EnterpriseResourceCandidate[] = [];
  const slices: EnterpriseCatalogSlice[] = [];

  const activeApp = requestedApp.ok ? requestedApp.value : null;
  let appEditAllowed: boolean | null = null;
  let appEditAccessComplete = true;
  if (request.appId && activeApp && caller.ok) {
    const access = await settle(() =>
      sources.appAccess({
        appId: activeApp.id,
        orgId: request.orgId,
        ownerId: activeApp.ownerId,
        caller: caller.value,
        action: 'edit',
      }),
    );
    appEditAccessComplete = access.ok;
    appEditAllowed = access.ok && access.value.allow;
  } else if (request.appId) {
    appEditAccessComplete = requestedApp.ok && caller.ok;
    appEditAllowed = false;
  }

  const intentDecisions: EnterpriseIntentDecision[] = [
    intentDecision('build.create', permissions, request.actor.role, ['studio'], 'POST', appEditAllowed),
    intentDecision('build.edit', permissions, request.actor.role, ['studio'], 'PATCH', appEditAllowed),
    intentDecision('data.configure', permissions, request.actor.role, ['data'], 'POST', appEditAllowed),
    intentDecision('tool.select', permissions, request.actor.role, ['studio', 'tools'], 'PATCH', appEditAllowed),
    intentDecision('action.configure', permissions, request.actor.role, ['studio'], 'PATCH', appEditAllowed),
    intentDecision('publish', permissions, request.actor.role, ['studio'], 'PATCH', appEditAllowed),
  ];
  const intent = (id: EnterpriseIntentDecision['intent']): EnterpriseIntentDecision =>
    intentDecisions.find((decision) => decision.intent === id)!;
  const buildSelection = intent(request.appId ? 'build.edit' : 'build.create');

  slices.push(
    slice(
      'identity',
      'Your organization access',
      !permissions.ok ? 'failed' : !memberships.ok || !teams.ok ? 'partial' : 'ready',
      'org-context',
      !permissions.ok
        ? 'permissions-unavailable'
        : !memberships.ok || !teams.ok
          ? 'membership-partial'
          : 'identity-ready',
      !permissions.ok
        ? 'Your permissions could not be verified.'
        : !memberships.ok || !teams.ok
          ? 'Your role is verified, but team context is temporarily incomplete.'
          : 'Your role, teams, and departments are verified.',
      '/governance/access',
    ),
  );

  if (domains.ok) {
    resources.push(
      ...dataCandidates(domains.value, connectors, request, dataVisible, buildSelection),
    );
  }
  slices.push(
    slice(
      'data',
      'Organization data',
      !domains.ok ? 'failed' : !connectors.ok ? 'partial' : 'ready',
      'org-context',
      !domains.ok ? 'data-unavailable' : !connectors.ok ? 'connector-partial' : 'data-ready',
      !domains.ok
        ? 'Organization data could not be loaded.'
        : !connectors.ok
          ? 'Data is listed, but connection availability could not be checked.'
          : 'Organization data and its declared connections are resolved.',
      '/data/sources',
    ),
  );

  if (tools.ok) {
    resources.push(
      ...registeredToolCandidates(tools.value, request.orgId, toolsVisible, intent('tool.select')),
    );
  }
  resources.push(
    ...primitiveCandidates(
      request.env ?? process.env,
      request.orgId,
      toolsVisible,
      intent('tool.select'),
    ),
  );
  let appToolAccessComplete = caller.ok;
  if (apps.ok) {
    const appTools = await appToolCandidates(
      apps.value,
      request,
      studioVisible && toolsVisible,
      intent('tool.select'),
      caller,
      sources.appAccess,
    );
    resources.push(...appTools.resources);
    appToolAccessComplete = appTools.accessComplete;
  }
  slices.push(
    slice(
      'capabilities',
      'Tools and reusable Apps',
      !tools.ok || !apps.ok || !caller.ok || !appToolAccessComplete ? 'partial' : 'ready',
      'catalog',
      !tools.ok || !apps.ok || !caller.ok || !appToolAccessComplete
        ? 'catalog-partial'
        : 'catalog-ready',
      !tools.ok || !apps.ok || !caller.ok || !appToolAccessComplete
        ? 'Built-in tools are available, but some organization capabilities could not be verified.'
        : 'Built-in tools, registered tools, and reusable Apps are resolved.',
      '/solutions/tools',
    ),
  );

  if (pipelines.ok) {
    resources.push(
      ...pipelineCandidates(
        pipelines.value,
        memberships,
        request,
        permissions.ok ? permissions.value.baseRole : 'viewer',
        pipelinesVisible,
        buildSelection,
      ),
    );
  }
  slices.push(
    slice(
      'pipelines',
      'Governed pipelines',
      pipelines.ok ? (memberships.ok ? 'ready' : 'partial') : 'failed',
      'pipeline',
      pipelines.ok
        ? memberships.ok
          ? 'pipelines-ready'
          : 'pipeline-access-partial'
        : 'pipelines-unavailable',
      pipelines.ok
        ? memberships.ok
          ? 'Governed pipelines and team access are resolved.'
          : 'Pipelines are loaded, but team access is incomplete.'
        : 'Governed pipelines could not be loaded.',
      '/runtime/pipelines',
    ),
  );

  const eligiblePriorHumanSteps = (activeApp?.steps ?? [])
    .filter((step) => step.kind === 'human')
    .map((step) => ({ ref: step.id, label: step.label }));
  if (connectors.ok) {
    resources.push(
      ...actionCandidates(
        connectors.value,
        request,
        studioVisible,
        eligiblePriorHumanSteps,
        intent('action.configure'),
      ),
    );
  }
  slices.push(
    slice(
      'actions',
      'Governed enterprise actions',
      connectors.ok ? 'ready' : 'failed',
      'action-policy',
      connectors.ok ? 'actions-resolved' : 'action-availability-unverified',
      connectors.ok
        ? 'Governed actions are matched against live organization connections and approval policy.'
        : 'Action availability could not be verified, so no action catalogue was returned.',
      '/data/sources',
    ),
  );

  slices.push(
    slice(
      'app',
      'Current App',
      !request.appId
        ? 'ready'
        : requestedApp.ok && caller.ok && appEditAccessComplete
          ? 'ready'
          : requestedApp.ok || caller.ok || appEditAccessComplete
            ? 'partial'
            : 'failed',
      'app-access',
      !request.appId
        ? 'app-not-requested'
        : !caller.ok || !appEditAccessComplete
          ? 'app-access-unavailable'
          : requestedApp.ok && activeApp
            ? 'app-resolved'
            : requestedApp.ok
              ? 'app-not-visible'
              : 'app-unavailable',
      !request.appId
        ? 'No existing App was requested.'
        : !caller.ok || !appEditAccessComplete
          ? 'Your App access could not be verified.'
          : requestedApp.ok && activeApp
            ? 'The current App was resolved inside your organization.'
            : requestedApp.ok
              ? 'The requested App is not available in your organization.'
              : 'The current App could not be checked.',
      '/solutions/apps',
    ),
  );

  return resolveEnterpriseContext({
    policyVersion: 'enterprise-context/v1',
    evaluatedAt: request.evaluatedAt ?? new Date().toISOString(),
    actor: identityFrom(request, permissions, memberships, teams),
    tenant: { effectiveOrgId: request.orgId, requestedOrgId: request.requestedOrgId ?? null },
    resources,
    intentDecisions,
    slices,
  });
}
