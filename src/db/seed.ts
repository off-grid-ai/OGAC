import 'dotenv/config';
import { randomUUID } from 'crypto';
import {
  abacRules,
  apiKeys,
  auditEvents,
  connectors,
  datasets,
  devices,
  goldenCases,
  governanceItems,
  ingestJobs,
  maskingRules,
  policies,
  routingRules,
  tenants,
  tools,
  users,
} from './schema';
import { db } from './index';

const SEED_DEVICES = [
  {
    id: 'dev_01',
    name: 'rajesh-mbp',
    os: 'macOS',
    role: 'Field Advisor',
    status: 'online',
    lastSeen: '2m ago',
    policyVersion: 7,
  },
  {
    id: 'dev_02',
    name: 'meera-iphone',
    os: 'iOS',
    role: 'Field Advisor',
    status: 'online',
    lastSeen: '5m ago',
    policyVersion: 7,
  },
  {
    id: 'dev_03',
    name: 'arjun-mbp',
    os: 'macOS',
    role: 'Underwriter',
    status: 'offline',
    lastSeen: '3h ago',
    policyVersion: 6,
  },
  {
    id: 'dev_04',
    name: 'sara-win',
    os: 'Windows',
    role: 'Claims',
    status: 'online',
    lastSeen: '1m ago',
    policyVersion: 7,
  },
  {
    id: 'dev_05',
    name: 'dev-laptop-12',
    os: 'macOS',
    role: 'Ops',
    status: 'offline',
    lastSeen: '2d ago',
    policyVersion: 5,
  },
] as const;

const SEED_AUDIT: ReadonlyArray<[string, string, number, boolean, string | null, string]> = [
  ['dev_01', 'gemma-local', 1240, false, null, 'ok'],
  ['dev_01', 'gemma-local', 880, true, 'crm.lookup', 'redacted'],
  ['dev_04', 'gemma-local', 2100, false, 'fs.read', 'ok'],
  ['dev_02', 'whisper-local', 540, false, null, 'ok'],
  ['dev_04', 'cloud-claude', 3200, true, null, 'blocked'],
];

const SEED_USERS = [
  { name: 'Dev Admin', email: 'dev@offgrid.local', role: 'admin' },
  { name: 'Priya Compliance', email: 'priya@offgrid.local', role: 'compliance' },
  { name: 'Sam Viewer', email: 'sam@offgrid.local', role: 'viewer' },
] as const;

async function seedUsers(): Promise<void> {
  const existing = await db.select().from(users);
  if (existing.length > 0) return;
  await db.insert(users).values(SEED_USERS.map((u) => ({ ...u })));
  process.stdout.write('seed: inserted 3 console users\n');
}

const SEED_CONNECTORS = [
  { id: 'con_core', name: 'Core Banking (Postgres)', type: 'postgres', status: 'connected' },
  { id: 'con_dwh', name: 'Snowflake Warehouse', type: 'snowflake', status: 'connected' },
  { id: 'con_crm', name: 'Salesforce CRM', type: 'salesforce', status: 'error' },
  { id: 'con_s3', name: 'Document Store (S3)', type: 's3', status: 'connected' },
] as const;

const SEED_RULES: ReadonlyArray<[string, string]> = [
  ['email', 'mask'],
  ['phone', 'mask'],
  ['pan', 'tokenize'],
  ['aadhaar', 'tokenize'],
  ['name', 'mask'],
];

const SEED_DATASETS: ReadonlyArray<[string, string, number, string]> = [
  ['customers', 'Core Banking', 1_284_000, 'pii'],
  ['transactions', 'Snowflake Warehouse', 48_200_000, 'internal'],
  ['claims_docs', 'Document Store', 92_000, 'phi'],
  ['product_catalog', 'Salesforce CRM', 3_400, 'public'],
];

async function seedDataPlane(): Promise<void> {
  const existing = await db.select().from(connectors);
  if (existing.length > 0) return;
  await db.insert(connectors).values(
    SEED_CONNECTORS.map((c) => ({
      ...c,
      lastSync: c.status === 'connected' ? new Date() : null,
    })),
  );
  await db
    .insert(maskingRules)
    .values(SEED_RULES.map((r) => ({ id: randomUUID(), kind: r[0], action: r[1] })));
  await db.insert(datasets).values(
    SEED_DATASETS.map((d) => ({
      id: randomUUID(),
      name: d[0],
      source: d[1],
      rows: d[2],
      classification: d[3],
    })),
  );
  await db.insert(ingestJobs).values([
    {
      id: randomUUID(),
      connectorId: 'con_core',
      connectorName: 'Core Banking (Postgres)',
      status: 'completed',
      records: 1_284_000,
    },
    {
      id: randomUUID(),
      connectorId: 'con_dwh',
      connectorName: 'Snowflake Warehouse',
      status: 'completed',
      records: 48_200_000,
    },
    {
      id: randomUUID(),
      connectorId: 'con_crm',
      connectorName: 'Salesforce CRM',
      status: 'failed',
      records: 0,
    },
  ]);
  process.stdout.write('seed: inserted 4 connectors, 5 masking rules, 4 datasets, 3 jobs\n');
}

const ANALYTICS_MODELS = ['gemma-local', 'whisper-local', 'cloud-claude'];
const BACKFILL_N = 80;
const DAY_MS = 86_400_000;

function backfillRow(i: number) {
  const ageDays = ((BACKFILL_N - i) / BACKFILL_N) * 14;
  const recent = i > BACKFILL_N * 0.8;
  const model = ANALYTICS_MODELS[i % ANALYTICS_MODELS.length];
  const latencyMs = (recent ? 1400 : 600) + Math.floor(Math.random() * 800);
  const blockedChance = recent ? 0.25 : 0.06;
  const r = Math.random();
  const outcome = r < blockedChance ? 'blocked' : r < blockedChance + 0.15 ? 'redacted' : 'ok';
  return {
    id: randomUUID(),
    deviceId: SEED_DEVICES[i % SEED_DEVICES.length].id,
    ts: new Date(Date.now() - ageDays * DAY_MS),
    model,
    tokens: 200 + Math.floor(Math.random() * 3000),
    leftDevice: model === 'cloud-claude' || outcome === 'redacted',
    tool: null,
    outcome,
    latencyMs,
  };
}

async function seedAnalyticsBackfill(): Promise<void> {
  const existing = await db.select().from(auditEvents);
  if (existing.length >= 30) return;
  await db.insert(auditEvents).values(Array.from({ length: BACKFILL_N }, (_, i) => backfillRow(i)));
  process.stdout.write(`seed: backfilled ${BACKFILL_N} audit events for analytics\n`);
}

const SEED_TENANTS = [
  {
    id: 'org_hdfcergo',
    name: 'HDFC Ergo General Insurance',
    plan: 'enterprise',
    enabledModules: [
      'fleet',
      'gateway',
      'control',
      'data',
      'brain',
      'agents',
      'analytics',
      'reports',
      'regulatory',
    ],
  },
  {
    id: 'org_runwal',
    name: 'Runwal Group',
    plan: 'enterprise',
    enabledModules: ['fleet', 'gateway', 'control', 'brain', 'agents', 'analytics'],
  },
] as const;

const SEED_ABAC: ReadonlyArray<[string, string, string, string, string, string]> = [
  ['*', 'data_class', 'eq', 'pii', 'brain', 'deny'],
  ['compliance', 'purpose', 'eq', 'audit', 'audit', 'allow'],
  ['viewer', 'data_class', 'in', 'pii,phi', 'data', 'deny'],
];

async function seedAdmin(): Promise<void> {
  const existing = await db.select().from(tenants);
  if (existing.length > 0) return;
  await db
    .insert(tenants)
    .values(SEED_TENANTS.map((t) => ({ ...t, enabledModules: [...t.enabledModules] })));
  await db.insert(abacRules).values(
    SEED_ABAC.map((r) => ({
      id: randomUUID(),
      role: r[0],
      attribute: r[1],
      operator: r[2],
      value: r[3],
      resource: r[4],
      effect: r[5],
    })),
  );
  process.stdout.write('seed: inserted 2 tenants, 3 ABAC rules\n');
}

const SEED_GOLDEN: ReadonlyArray<[string, string]> = [
  ['how do I handle a death claim?', 'FNOL'],
  ['verify customer identity', 'KYC'],
  ['customer says term life is a waste of money', 'Objection'],
];

async function seedEvals(): Promise<void> {
  const existing = await db.select().from(goldenCases);
  if (existing.length > 0) return;
  await db
    .insert(goldenCases)
    .values(SEED_GOLDEN.map((g) => ({ id: randomUUID(), query: g[0], expected: g[1] })));
  process.stdout.write('seed: inserted 3 golden cases\n');
}

const SEED_TOOLS: ReadonlyArray<[string, string, string, string]> = [
  [
    'Salesforce CRM lookup',
    'http',
    'https://crm.internal/api',
    'Look up CRM accounts, contacts, and opportunities. Use for customer/account/CRM queries.',
  ],
  [
    'Calendar',
    'mcp',
    'mcp://calendar',
    'Read and create calendar events. Use to schedule, check availability, or send invites.',
  ],
  [
    'Email send',
    'http',
    'https://mail.internal/send',
    'Send an email. Use to send, notify, or follow up with someone.',
  ],
];

async function seedTools(): Promise<void> {
  const existing = await db.select().from(tools);
  if (existing.length > 0) return;
  await db.insert(tools).values(
    SEED_TOOLS.map((t) => ({
      id: randomUUID(),
      name: t[0],
      type: t[1],
      endpoint: t[2],
      description: t[3],
    })),
  );
  process.stdout.write('seed: inserted 3 tools\n');
}

// [name, priority, attribute, operator, value, action, model, fallback]
const SEED_ROUTING: ReadonlyArray<
  [string, number, string, string, string, string, string, string]
> = [
  ['PII stays local', 10, 'data_class', 'eq', 'pii', 'local', 'gemma-local', ''],
  ['PHI stays local', 20, 'data_class', 'eq', 'phi', 'local', 'gemma-local', ''],
  [
    'Long-context → cloud (leashed)',
    30,
    'task',
    'eq',
    'longcontext',
    'cloud',
    'cloud-claude',
    'gemma-local',
  ],
  ['Cost-sensitive → cheapest local', 40, 'cost', 'eq', 'low', 'local', 'gemma-local', ''],
  ['India data → on-device', 15, 'region', 'eq', 'in', 'local', 'gemma-local', ''],
  [
    'EU data → EU-region model',
    16,
    'region',
    'eq',
    'eu',
    'cloud',
    'cloud-claude-eu',
    'gemma-local',
  ],
];

async function seedRouting(): Promise<void> {
  const existing = await db.select().from(routingRules);
  if (existing.length > 0) return;
  await db.insert(routingRules).values(
    SEED_ROUTING.map((r) => ({
      id: randomUUID(),
      name: r[0],
      priority: r[1],
      attribute: r[2],
      operator: r[3],
      value: r[4],
      action: r[5],
      model: r[6],
      fallback: r[7],
    })),
  );
  process.stdout.write('seed: inserted 6 routing rules\n');
}

// [id, name, subjectType, subject, budgetUsd]
const SEED_KEYS: ReadonlyArray<[string, string, string, string, number]> = [
  ['key_rajesh', 'Rajesh (Field Advisor)', 'user', 'rajesh', 50],
  ['key_claims', 'Claims project', 'project', 'claims', 500],
  ['key_uw', 'Underwriting project', 'project', 'underwriting', 200],
];

async function seedFinops(): Promise<void> {
  const existing = await db.select().from(apiKeys);
  if (existing.length > 0) return;
  await db.insert(apiKeys).values(
    SEED_KEYS.map((k) => ({
      id: k[0],
      name: k[1],
      prefix: `ogk_${k[0].slice(4, 10)}…`,
      subjectType: k[2],
      subject: k[3],
      budgetUsd: k[4],
    })),
  );
  // Key-attributed audit events so FinOps shows cost by model / key / subject.
  const models = ['gemma-local', 'gemma-local', 'cloud-claude'];
  await db.insert(auditEvents).values(
    Array.from({ length: 45 }, (_, i) => {
      const key = SEED_KEYS[i % SEED_KEYS.length];
      const model = models[i % models.length];
      return {
        id: randomUUID(),
        deviceId: SEED_DEVICES[i % SEED_DEVICES.length].id,
        ts: new Date(Date.now() - (i % 14) * DAY_MS),
        model,
        tokens: 500 + Math.floor(Math.random() * 4000),
        leftDevice: model === 'cloud-claude',
        tool: null,
        outcome: 'ok',
        latencyMs: 400 + Math.floor(Math.random() * 1600),
        keyId: key[0],
      };
    }),
  );
  process.stdout.write('seed: inserted 3 virtual keys + 45 billed audit events\n');
}

// [kind, title, owner, status]
const SEED_GOVERNANCE: ReadonlyArray<[string, string, string, string]> = [
  ['policy', 'AI Use Policy', 'CISO', 'active'],
  ['ethics_review', 'AI Ethics & Review Board', 'Ethics Committee', 'active'],
  ['raci', 'AI Roles & RACI matrix', 'Head of AI', 'active'],
  ['training', 'AI training & change management', 'L&D', 'due'],
  ['vendor', 'Vendor & procurement controls', 'Procurement', 'active'],
  ['insurance', 'AI insurance & liability', 'Risk', 'active'],
  ['drill', 'Incident tabletop drill (Q2)', 'SecOps', 'due'],
  ['impact_assessment', 'Algorithmic impact assessment — claims model', 'DPO', 'active'],
];

async function seedGovernance(): Promise<void> {
  const existing = await db.select().from(governanceItems);
  if (existing.length > 0) return;
  await db.insert(governanceItems).values(
    SEED_GOVERNANCE.map((g) => ({
      id: randomUUID(),
      kind: g[0],
      title: g[1],
      owner: g[2],
      status: g[3],
      reviewedAt: '2026-05-01',
    })),
  );
  process.stdout.write('seed: inserted 8 governance items\n');
}

async function seed(): Promise<void> {
  await seedUsers();
  await seedGovernance();
  await seedDataPlane();
  await seedAnalyticsBackfill();
  await seedAdmin();
  await seedEvals();
  await seedTools();
  await seedRouting();
  await seedFinops();
  const existing = await db.select().from(devices);
  if (existing.length > 0) {
    process.stdout.write('seed: devices already present, skipping device/policy seed\n');
    return;
  }
  await db.insert(policies).values({
    version: 7,
    egressAllowed: false,
    guardrails: ['pii-input', 'injection-scan', 'grounding'],
    allowedModels: ['gemma-local', 'whisper-local'],
  });
  await db.insert(devices).values(SEED_DEVICES.map((d) => ({ ...d })));
  await db.insert(auditEvents).values(
    SEED_AUDIT.map((s, i) => ({
      id: randomUUID(),
      deviceId: s[0],
      ts: new Date(Date.now() - i * 60_000),
      model: s[1],
      tokens: s[2],
      leftDevice: s[3],
      tool: s[4],
      outcome: s[5],
    })),
  );
  process.stdout.write('seed: inserted policy v7, 5 devices, 5 audit events\n');
}

seed()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`seed failed: ${String(e)}\n`);
    process.exit(1);
  });
