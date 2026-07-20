import {
  defineCapability,
  type CapabilityGateInput,
  type ServiceCapabilityAudit,
} from '../service-capability-contract';

/**
 * Runtime/governance/operations lane of the 43-service platform inventory.
 *
 * Only services with a bounded, versioned operator-outcome denominator appear in `AUDITS`.
 * The rest remain explicitly unaudited so the canonical projection renders “not audited”, never
 * an invented 0% or 100%. Existing LiteLLM and Presidio audits stay owned by the canonical legacy
 * registry until the orchestrator moves them; this file does not duplicate their evidence.
 */

type CapabilitySpec = readonly [
  id: string,
  name: string,
  summary: string,
  uiHref: string,
  uiLabel: string,
  gap: string,
  gates: CapabilityGateInput,
];

interface AuditSpec {
  serviceId: string;
  serviceLabel: string;
  upstreamVersion: string;
  versionSource: string;
  auditState?: ServiceCapabilityAudit['auditState'];
  auditStateEvidence?: string;
  summary: string;
  capabilities: readonly CapabilitySpec[];
}

function audit(spec: AuditSpec): ServiceCapabilityAudit {
  return {
    serviceId: spec.serviceId,
    serviceLabel: spec.serviceLabel,
    upstreamVersion: spec.upstreamVersion,
    versionSource: spec.versionSource,
    auditedAt: '2026-07-20',
    auditState: spec.auditState ?? 'stale',
    auditStateEvidence:
      spec.auditState === 'current'
        ? null
        : (spec.auditStateEvidence ??
          'The configured version is known, but the fleet ledger does not record the live image digest.'),
    summary: spec.summary,
    items: spec.capabilities.map((capability) => defineCapability(...capability)),
  };
}

const FLEET_EVIDENCE =
  '../onprem-fleet-orchestration/deploy/onprem/SERVICE_MAP.md and SERVER_STATE.md, verified 2026-07-20';

export const RUNTIME_GOVERNANCE_OPERATIONS_AUDITS = [
  audit({
    serviceId: 'console',
    serviceLabel: 'Console',
    upstreamVersion: '61b86a720f725bbd6fdd40d0368e499e22c1bc2e',
    versionSource: `${FLEET_EVIDENCE} release stamp`,
    auditStateEvidence:
      'The fleet verified this immutable release, but the current working release has moved beyond it and is not deployed.',
    summary:
      'Bounded first-party denominator: authenticated operator access, management routes, tenant isolation, and durable run dispatch. Self-restart remains host-owned.',
    capabilities: [
      [
        'authenticated-control-plane',
        'Authenticated tenant control plane',
        'Open the governed management Console with tenant-scoped data and actions.',
        '/operations',
        'Open operations',
        '',
        [
          'yes',
          'The immutable Console release provides session and service-account authorization.',
          'yes',
          'NextAuth, tenancy, authorization, and repository seams are wired.',
          'yes',
          'All canonical domains are reachable through URL-driven Console routes.',
          'yes',
          'The authenticated integration harness exercised bank and insurance tenant routes.',
        ],
      ],
      [
        'tenant-management',
        'Tenant-isolated management state',
        'Create and manage product entities without crossing organization boundaries.',
        '/governance/access',
        'Manage access',
        '',
        [
          'yes',
          'The first-party release includes tenant-owned repositories and authorization rules.',
          'yes',
          'Database, claims, and policy adapters enforce organization scope.',
          'yes',
          'Domain management routes expose tenant-scoped entities and actions.',
          'yes',
          'Bank and insurance seed checks proved isolation of solution records.',
        ],
      ],
      [
        'self-lifecycle',
        'Console process lifecycle',
        'Deploy, restart, and roll back the control plane safely.',
        '/operations/admin',
        'Inspect administration',
        'Keep process lifecycle in the private deployment runbook; expose immutable build and rollback evidence without adding an unsafe self-restart action.',
        [
          'yes',
          'The release has native start, stop, deploy, and rollback runbooks.',
          'partial',
          'Deployment scripts own lifecycle; the running process does not control itself.',
          'partial',
          'Administration explains host ownership but does not execute deployment lifecycle.',
          'yes',
          'The fleet ledger records an immutable release and prepared rollback source.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'gateway',
    serviceLabel: 'AI Gateway',
    upstreamVersion: 'Console release 61b86a720f725bbd6fdd40d0368e499e22c1bc2e',
    versionSource: `${FLEET_EVIDENCE}; packages/gateway and scripts/gateway-aggregator.mjs`,
    auditStateEvidence:
      'The fleet verified this first-party gateway release, but the current working release is newer and not deployed.',
    summary:
      'Bounded first-party denominator: authenticated inference, model discovery, fleet routing, and request governance. Direct backend access is not part of the operator contract.',
    capabilities: [
      [
        'authenticated-inference',
        'Authenticated inference',
        'Run OpenAI-compatible inference through the governed on-prem door.',
        '/runtime/gateways',
        'Inspect gateways',
        '',
        [
          'yes',
          'The first-party gateway supports authenticated OpenAI-compatible inference.',
          'yes',
          'src/lib/gateway.ts and the inference adapter call the real gateway with service credentials.',
          'yes',
          'Runtime gateway and model surfaces expose the governed endpoint.',
          'yes',
          'The fleet gate proved a real completion and invalid-bearer rejection.',
        ],
      ],
      [
        'fleet-routing',
        'Fleet model routing',
        'Discover healthy models and route requests across active fleet nodes.',
        '/runtime/models',
        'Manage models',
        '',
        [
          'yes',
          'The gateway aggregator release provides pool membership, health, and routing.',
          'yes',
          'Gateway control and model-catalog adapters consume the real pool.',
          'yes',
          'Models, gateways, nodes, and clusters expose the routing relationship.',
          'yes',
          'The eight-node registry and Qwen/Gemma/Qwythos completions were verified.',
        ],
      ],
      [
        'request-governance',
        'Request policy and guardrail spine',
        'Apply tenancy, policy, guardrails, routing, and audit to inference requests.',
        '/governance/posture',
        'Inspect governance posture',
        '',
        [
          'yes',
          'The first-party gateway release supports the Off Grid governance contract.',
          'yes',
          'Policy, guardrail, credential, traffic, and audit adapters are wired.',
          'yes',
          'Governance and runtime surfaces expose effective controls and evidence.',
          'yes',
          'Governed denial and merged guard scans passed in the recovery gate.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'keycloak',
    serviceLabel: 'Identity & SSO',
    upstreamVersion: '26.0.7',
    versionSource: 'deploy/docker-compose.yml (quay.io/keycloak/keycloak:26.0.7)',
    summary:
      'Relevant denominator: human SSO, service accounts, tenant access, session/revocation controls, and identity lifecycle. Full realm administration is intentionally abstracted.',
    capabilities: [
      [
        'human-sso',
        'Human SSO and sessions',
        'Authenticate operators through the configured enterprise identity provider.',
        '/governance/access',
        'Manage access',
        'Prove the production Keycloak provider, logout, revocation, and session-expiry lifecycle; authenticated access alone is not the full lifecycle.',
        [
          'yes',
          'Keycloak 26.0.7 provides OIDC realms, clients, and user sessions.',
          'partial',
          'NextAuth has Keycloak support, but production-provider lifecycle evidence is incomplete.',
          'yes',
          'Access and team surfaces manage product membership and roles.',
          'partial',
          'Authenticated tenant sessions passed; logout/revocation/expiry were not re-verified.',
        ],
      ],
      [
        'service-accounts',
        'Service-account grants',
        'Issue client-credential grants to internal service adapters without hard-coded bearer tokens.',
        '/governance/access',
        'Inspect service access',
        'Expose the bounded client lifecycle and revocation posture without recreating raw realm administration.',
        [
          'yes',
          'Keycloak supports confidential clients and client-credential grants.',
          'yes',
          'The service credential broker exchanges OpenBao-held client secrets for grants.',
          'partial',
          'Access surfaces show product access; full client lifecycle is not a dedicated UI.',
          'yes',
          'Five client-credential grants passed in the fleet recovery evidence.',
        ],
      ],
      [
        'federation-mfa',
        'Federation and MFA policy',
        'Federate workforce identity and require suitable authentication assurance.',
        '/governance/access',
        'Manage access',
        'Audit the configured identity-provider and authentication-flow contracts, then expose assurance and recovery state without recreating raw Keycloak administration.',
        [
          'yes',
          'Keycloak 26.0.7 supports identity brokering and configurable authentication flows.',
          'no',
          'No production federation/MFA adapter contract is evidenced.',
          'no',
          'The Console does not expose federation or MFA posture.',
          'no',
          'No seeded bank or insurance identity-assurance workflow is verified.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'temporal',
    serviceLabel: 'Durable Workflows',
    upstreamVersion: 'Temporal Server 1.25.2 / UI 2.32.0',
    versionSource: 'deploy/docker-compose.yml',
    summary:
      'Relevant denominator: durable app/agent/chat dispatch, run lifecycle, schedules, retries, visibility, cancellation, and worker readiness.',
    capabilities: [
      [
        'durable-dispatch',
        'Durable app, agent, and chat dispatch',
        'Submit governed work to durable task queues and preserve run history.',
        '/operations/runs',
        'Inspect runs',
        '',
        [
          'yes',
          'Temporal 1.25.2 provides durable workflows, activities, histories, and task queues.',
          'yes',
          'App, agent, chat, schedule, and visibility adapters use Temporal clients and workers.',
          'yes',
          'Operations runs and app/agent run detail pages expose durable state.',
          'yes',
          'The fleet gate proved the Console durable-run surface and a durable denial path.',
        ],
      ],
      [
        'run-actions',
        'Run cancellation, retry, and replay',
        'Intervene in a failed or long-running workflow without losing audit history.',
        '/operations/runs',
        'Manage runs',
        'Verify each action against the deployed service and preserve user-visible action evidence.',
        [
          'yes',
          'Temporal supports termination, cancellation, reset/replay, and retry semantics.',
          'partial',
          'Run adapters expose bounded actions; the complete action matrix is not re-audited.',
          'partial',
          'Run detail surfaces expose actions, but complete live action evidence is absent.',
          'no',
          'No immutable cancellation/retry/replay workflow evidence is recorded.',
        ],
      ],
      [
        'worker-readiness',
        'Worker and task-queue readiness',
        'Know whether app, agent, and chat queues have compatible pollers before accepting work.',
        '/operations/services',
        'Inspect workers',
        'Expose task-queue compatibility, poller identity, queue lag, and drain state for each worker.',
        [
          'yes',
          'Temporal exposes task-queue pollers and worker build/versioning primitives.',
          'partial',
          'Indirect worker readiness is inferred from run state rather than a complete readiness contract.',
          'partial',
          'Workers appear in the service directory without queue depth or poller detail.',
          'partial',
          'Runs succeeded, but each worker queue was not independently proven.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'opa',
    serviceLabel: 'Policy Engine',
    upstreamVersion: '0.70.0',
    versionSource: 'deploy/docker-compose.yml (openpolicyagent/opa:0.70.0)',
    summary:
      'Relevant denominator: policy/module/data lifecycle, decision evaluation, bundles, decision logs, and failure posture. Rego stays behind governed product modules.',
    capabilities: [
      [
        'policy-decisions',
        'Governed policy decisions',
        'Evaluate tenant-scoped allow/deny decisions and preserve explainable evidence.',
        '/governance/policies/decisions',
        'Inspect decisions',
        '',
        [
          'yes',
          'OPA 0.70.0 provides policy evaluation and decision APIs.',
          'yes',
          'The policy adapter evaluates real requests and records decisions.',
          'yes',
          'Policies and evidence routes expose rules and decisions.',
          'yes',
          'The fleet gate proved a governed denial.',
        ],
      ],
      [
        'policy-lifecycle',
        'Policy and module lifecycle',
        'Create, edit, publish, version, and retire governed policy rules.',
        '/governance/policies/rules',
        'Manage rules',
        'Prove publish/reload and rollback against deployed OPA, including invalid-policy failure behavior.',
        [
          'yes',
          'OPA provides policy and data document APIs.',
          'partial',
          'Console policy rules/modules exist; complete deployed reload and rollback evidence is missing.',
          'yes',
          'Rules, templates, modules, and decisions have canonical nested routes.',
          'partial',
          'Seeded policies exist, but publish/reload/rollback were not all live-proven.',
        ],
      ],
      [
        'bundles-decision-logs',
        'Bundles and decision-log export',
        'Distribute policy safely and export complete decision telemetry.',
        '/governance/evidence/audit',
        'Inspect audit evidence',
        'Wire bundle activation and decision-log export through managed adapters, then prove rollback and loss handling.',
        [
          'yes',
          'OPA 0.70.0 supports bundles and decision-log plugins.',
          'no',
          'No managed bundle or OPA decision-log plugin adapter is evidenced.',
          'partial',
          'Off Grid audit decisions are visible, but OPA bundle/log lifecycle is not.',
          'no',
          'No bundle rollout or decision-log export workflow is verified.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'openbao',
    serviceLabel: 'Secrets Vault',
    upstreamVersion: '2.1.0',
    versionSource: 'deploy/docker-compose.yml (openbao/openbao:2.1.0)',
    summary:
      'Relevant denominator: secret CRUD, connector and service credentials, leases, mounts, rotation, auth, policy, audit, and recovery. Root administration is excluded.',
    capabilities: [
      [
        'secret-lifecycle',
        'Tenant secret lifecycle',
        'Create, read, update, and delete governed secrets without revealing values in client state.',
        '/governance/secrets/keys',
        'Manage keys',
        '',
        [
          'yes',
          'OpenBao 2.1.0 provides versioned KV secret lifecycle APIs.',
          'yes',
          'The secrets adapter and connector-secret seam perform server-side lifecycle operations.',
          'yes',
          'Keys and connector forms expose product-owned secret operations.',
          'yes',
          'A connector vault round-trip and five service-secret reads passed.',
        ],
      ],
      [
        'dynamic-credentials',
        'Dynamic database credentials and leases',
        'Issue short-lived credentials, inspect leases, and revoke access.',
        '/governance/secrets/dynamic-database',
        'Manage dynamic credentials',
        'Prove database engine configuration, issue/renew/revoke, and expiry in the live fleet.',
        [
          'yes',
          'OpenBao 2.1.0 provides database secrets and lease APIs.',
          'partial',
          'Dynamic credential models and routes exist; full live engine lifecycle is unverified.',
          'yes',
          'Dynamic database and lease routes are deep-linkable.',
          'no',
          'No immutable issue/renew/revoke workflow is in the fleet ledger.',
        ],
      ],
      [
        'vault-recovery',
        'Vault audit and disaster recovery',
        'Back up encrypted state, inspect audit devices, and recover without credential loss.',
        '/operations/backups',
        'Manage backups',
        'Add and verify OpenBao backup/restore plus audit-device evidence; a mounted volume alone is not recovery proof.',
        [
          'yes',
          'OpenBao supports file-backed storage, audit devices, and operational recovery procedures.',
          'partial',
          'The persistent volume is declared; complete backup/restore and audit adapters are absent.',
          'partial',
          'Backup and evidence surfaces do not expose a full vault recovery drill.',
          'no',
          'No OpenBao restore drill is recorded.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'unleash',
    serviceLabel: 'Feature Flags',
    upstreamVersion: '6.6 mutable minor tag',
    versionSource: 'deploy/docker-compose.yml (unleashorg/unleash-server:6.6)',
    auditStateEvidence:
      'The configured 6.6 tag is not digest-pinned; the live immutable upstream version is unknown.',
    summary:
      'Relevant denominator: flag CRUD, enablement, rollout strategies, variants, environment state, and audited product use. The mutable tag prevents a current availability claim.',
    capabilities: [
      [
        'flag-lifecycle',
        'Feature-flag lifecycle',
        'Create, describe, enable, disable, and archive product flags.',
        '/operations/configuration',
        'Manage configuration',
        'Pin the live image and prove create-to-archive through the operator UI.',
        [
          'yes',
          'Unleash 6.6 documentation describes feature CRUD and environment enablement.',
          'yes',
          'Admin adapters implement create, description update, toggle, and archive.',
          'partial',
          'Configuration consumes flags; complete lifecycle discoverability is not live-proven.',
          'no',
          'No seeded end-to-end flag lifecycle is recorded.',
        ],
      ],
      [
        'progressive-rollout',
        'Progressive rollout and variants',
        'Roll out a capability gradually and choose controlled variants.',
        '/operations/configuration',
        'Manage rollouts',
        'Prove a tenant-scoped percentage rollout and variant changes real product behavior.',
        [
          'yes',
          'Unleash 6.6 provides strategies and variants.',
          'yes',
          'Adapters implement rollout percentages and variant payloads.',
          'partial',
          'No dedicated rollout/variant journey is evidenced in the Console.',
          'no',
          'No bank or insurance workflow is verified under a rollout.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'redis',
    serviceLabel: 'Redis',
    upstreamVersion: '7.4 mutable alpine tag',
    versionSource: 'deploy/docker-compose.yml (redis:7.4-alpine)',
    auditStateEvidence:
      'The configured 7.4-alpine tag is not digest-pinned and live backend selection is not recorded.',
    summary:
      'Relevant denominator: shared response-cache get/set/expiry/invalidation, backend health, and graceful fallback. Redis remains an implementation behind the cache port.',
    capabilities: [
      [
        'shared-response-cache',
        'Shared response cache',
        'Cache governed responses across Console processes with bounded expiry.',
        '/operations/services/redis',
        'Inspect Redis',
        'Prove the deployed runtime selects Redis and expose hit, miss, expiry, and invalidation evidence.',
        [
          'yes',
          'Redis 7.4 provides key/value storage and expiry.',
          'partial',
          'The cache port supports Redis, but the running backend is not identified in evidence.',
          'partial',
          'Service detail exposes health, not cache operations or metrics.',
          'no',
          'No production request trace proves a Redis hit or invalidation.',
        ],
      ],
      [
        'failure-fallback',
        'Cache failure fallback',
        'Continue safely on an in-process cache when Redis is unavailable.',
        '/operations/health',
        'Inspect health',
        'Prove failover and recovery under a real connection loss without hiding stale data.',
        [
          'yes',
          'The Off Grid cache contract defines an in-process fallback.',
          'yes',
          'The Redis adapter degrades to the in-process implementation.',
          'partial',
          'Health labels the fallback; operators cannot inspect transition history.',
          'no',
          'No deployed failover/recovery workflow is recorded.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'superset',
    serviceLabel: 'BI & Dashboards',
    upstreamVersion: '4.1.1',
    versionSource: 'deploy/docker-compose.yml (apache/superset:4.1.1)',
    summary:
      'Relevant operator denominator: governed dashboard provisioning, native chart read-back, embedded access, and bounded authoring. Superset remains the query engine; the Console owns the operator experience.',
    capabilities: [
      [
        'dashboard-provisioning',
        'Governed dashboard provisioning',
        'Idempotently create the Off Grid database, dataset, charts, and dashboard.',
        '/insights/usage/dashboards',
        'Manage dashboards',
        '',
        [
          'yes',
          'Superset 4.1.1 provides database, dataset, chart, dashboard, and embedded-config APIs.',
          'yes',
          'src/lib/superset.ts authenticates and performs idempotent find-or-create provisioning.',
          'yes',
          'Insights > Usage > Dashboards is the canonical governed dashboard route.',
          'yes',
          'The fleet ledger records dashboard 1 and charts 1 and 2 provisioned through the Console API.',
        ],
      ],
      [
        'native-chart-readback',
        'Native governed chart read-back',
        'Run Superset chart queries and render the results inside the Off Grid visual system.',
        '/insights/usage/dashboards',
        'View dashboards',
        '',
        [
          'yes',
          'Superset 4.1.1 provides chart-data APIs.',
          'yes',
          'src/lib/superset-data.ts resolves owned charts, runs chart-data queries, and shapes results.',
          'yes',
          'The Console renders the governed dashboard in its native Insights surface.',
          'yes',
          'The provisioned request and token charts query the live Console database.',
        ],
      ],
      [
        'embedded-access',
        'Scoped embedded dashboard access',
        'Mint short-lived guest access only after verifying the owned dashboard exists.',
        '/insights/usage/dashboards',
        'Open governed dashboard',
        'Capture one immutable guest-token and expiry/revocation workflow; configured code alone is not production proof.',
        [
          'yes',
          'Superset 4.1.1 supports embedded dashboard configuration and guest tokens.',
          'yes',
          'The Superset adapter verifies the dashboard before minting a scoped guest token.',
          'yes',
          'The dashboard route can open the governed embedded resource.',
          'partial',
          'Dashboard provisioning is proven, but guest-token expiry and revocation are not in fleet evidence.',
        ],
      ],
      [
        'sql-authoring',
        'Advanced SQL and chart authoring',
        'Let authorized analysts explore governed data and publish additional visualizations.',
        '/insights/usage/dashboards',
        'Open dashboard tools',
        'Define the analyst authorization boundary and either integrate bounded authoring or explicitly keep it in the separately authenticated Superset surface.',
        [
          'yes',
          'Superset 4.1.1 provides SQL Lab, datasets, charts, and dashboards.',
          'partial',
          'The Console provisions its owned assets but does not wrap the full authoring lifecycle.',
          'partial',
          'Operators can link to Superset; authoring is not a native Off Grid CRUD surface.',
          'no',
          'No seeded analyst authoring workflow is verified.',
        ],
      ],
    ],
  }),
  audit({
    serviceId: 'fleetdm',
    serviceLabel: 'Device Management',
    upstreamVersion: '4.87.0',
    versionSource: 'deploy/docker-compose.yml (fleetdm/fleet:v4.87.0)',
    summary:
      'Relevant Community-edition denominator: host inventory, live/saved queries, software/CVE visibility, and policies. Premium MDM control is explicitly unsupported without licensing.',
    capabilities: [
      [
        'host-inventory-software',
        'Host and software inventory',
        'Inspect enrolled devices, installed software, and vulnerability context.',
        '/operations/devices',
        'Manage devices',
        'Complete operator setup, enroll a real test host, and prove inventory refresh.',
        [
          'yes',
          'Fleet 4.87.0 Community provides host and software inventory.',
          'yes',
          'Fleet adapters map hosts and software inventory.',
          'yes',
          'Operations device list and detail routes expose inventory.',
          'no',
          'The live fleet has no operator-owned enrollment evidence.',
        ],
      ],
      [
        'queries-policies',
        'Live queries and compliance policies',
        'Run bounded osquery queries and manage host compliance checks.',
        '/operations/devices',
        'Manage device posture',
        'Prove one safe query and one policy lifecycle against an enrolled live host.',
        [
          'yes',
          'Fleet 4.87.0 Community provides queries, campaigns, and policies.',
          'yes',
          'Adapters and routes implement live query and policy CRUD.',
          'yes',
          'Device surfaces expose query and policy actions.',
          'no',
          'No enrolled-host query or policy evidence is recorded.',
        ],
      ],
      [
        'premium-mdm',
        'Premium device control',
        'Lock, wipe, and push configuration profiles to managed devices.',
        '/operations/devices',
        'Inspect device controls',
        'Keep these controls unavailable until a compatible Fleet Premium license, server capability, enrollment, and live safety proof exist.',
        [
          'no',
          'The deployed Community configuration does not establish Premium MDM availability.',
          'partial',
          'Adapters model commands but gate unavailable controls.',
          'partial',
          'The UI can explain unavailability without presenting a working control.',
          'no',
          'No device-control workflow is verified.',
        ],
      ],
    ],
  }),
] as const satisfies readonly ServiceCapabilityAudit[];

/**
 * These services belong to this lane but still lack a versioned upstream denominator. Keeping the
 * IDs explicit proves inventory coverage while leaving the canonical capability summary honestly
 * `not-audited`.
 */
export const RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS = [
  'edge-gateway',
  'provit',
  'llm-guard',
  'gateway-control',
  'agent-worker',
  'app-worker',
  'chat-worker',
  'cloudflared',
  'landing',
  'status-page',
  'litellm-forwarder',
  'observability-forwarder',
  'fleet-forwarder',
] as const;

/** Existing item-level audits remain in the canonical registry and must not be duplicated. */
export const RUNTIME_GOVERNANCE_OPERATIONS_DELEGATED_SERVICE_IDS = ['litellm', 'presidio'] as const;

export const RUNTIME_GOVERNANCE_OPERATIONS_SERVICE_IDS = [
  ...RUNTIME_GOVERNANCE_OPERATIONS_AUDITS.map((record) => record.serviceId),
  ...RUNTIME_GOVERNANCE_OPERATIONS_UNAUDITED_SERVICE_IDS,
  ...RUNTIME_GOVERNANCE_OPERATIONS_DELEGATED_SERVICE_IDS,
] as const;
