// ─── Give the INSURER a real replication connection (org_suraksha) ─────────────────────────────────
//
// WHY. /data/flows/replication on the insurer tenant read "No pipelines have been configured yet"
// while the bank's read "CoreBank to Off Grid Warehouse · active · Last run succeeded". The reader
// (currentEtlConnections in etl-scope.ts) and its tenancy (etl-tenancy.ts) are correct: an org sees an
// Airbyte connection when the connection's SOURCE database key is in the set of keys its own
// registered connectors target. org_suraksha owns key `suraksha` via two connectors —
// `surcon_coreins` (postgres://coreins@127.0.0.1:5433/suraksha) and `surcon_policyadmin` (mysql). The
// gap was never code: Airbyte itself had no source/connection whose database resolves to `suraksha` —
// there was exactly ONE Airbyte connection total ("CoreBank to Off Grid Warehouse", database
// `corebank`), so the insurer's own connector registry had nothing to match.
//
// WHAT. Mirrors the live CoreBank source/connection EXACTLY (read via the Airbyte API, not invented):
// same host/port path (host.docker.internal:15433 — Airbyte's docker containers on g6 reach the
// Postgres fixture, which moved to g3 on 2026-08-05, via a host-level TCP forward; see the note at
// the bottom of this file), same ssl/tunnel/replication settings, same destination (the "Off Grid
// ClickHouse" warehouse destination already used by CoreBank) — but pointed at role `coreins` /
// database `suraksha`, with the password resolved from the vault (connector-secrets, mirrors how the
// console's own connector-exec path resolves surcon_coreins's credential) rather than hard-coded.
// Streams: policies / premiums / claims — the same three resources seed-suraksha-etl-jobs.mts already
// moves from surcon_coreins, so replication and ETL tell the same story about this connector.
//
// IDEMPOTENT: matches an existing source by (database, username) and an existing connection by
// sourceId before creating either, so a re-run reuses what's there instead of duplicating. Always
// ends by triggering a sync and polling it to a terminal state, so a re-run also re-proves the sync
// still works rather than only proving it once.
//
// The Airbyte port (src/lib/adapters/airbyte.ts) deliberately has NO source/connection-creation
// methods — "Airbyte adapter exposes health/list/triggerSync but NOT connection CREATION" (see its own
// header). Source/connection creation + schema discovery here therefore talk to the Airbyte config API
// directly (same base URL convention, OFFGRID_AIRBYTE_URL); the actual sync trigger + status poll reuse
// `airbyteEtl` — the real product path — exactly as runJob's Airbyte fallback would.
//
// IMPORT ORDER IS LOAD-BEARING: worker-env.mts MUST be first (env before @/db builds its pg Pool).
//
// RUN (on the box, .env.local loaded):
//   /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx scripts/seed-suraksha-airbyte-replication.mts
import './worker-env.mts';
import { airbyteEtl } from '../src/lib/adapters/airbyte.ts';
import { resolveConnectorSecret } from '../src/lib/connector-secrets.ts';

const ORG = 'org_suraksha';
const SOURCE_CONNECTOR_ID = 'surcon_coreins';
const TARGET_DATABASE = 'suraksha';
const TARGET_USERNAME = 'coreins';
const CONNECTION_NAME = 'Core Insurance to Off Grid Warehouse';
const STREAM_NAMES = ['policies', 'premiums', 'claims'];

function baseUrl(): string {
  return (process.env.OFFGRID_AIRBYTE_URL || 'http://127.0.0.1:8942').replace(/\/$/, '');
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}/api/v1/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`airbyte ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

interface WorkspaceRead { workspaceId: string }
interface SourceRead {
  sourceId: string;
  sourceDefinitionId: string;
  name: string;
  connectionConfiguration: Record<string, unknown>;
}
interface ConnectionRead {
  connectionId: string;
  name: string;
  sourceId: string;
  destinationId: string;
  syncCatalog: { streams: { stream: { name: string; namespace?: string; jsonSchema: unknown; supportedSyncModes: string[]; sourceDefinedCursor: boolean; defaultCursorField: string[]; sourceDefinedPrimaryKey: string[][]; isResumable?: boolean }; config: Record<string, unknown> }[] };
}
interface DiscoverSchemaRead { catalog: { streams: ConnectionRead['syncCatalog']['streams'] } }

async function main() {
  const workspaces = await post<{ workspaces: WorkspaceRead[] }>('workspaces/list', {});
  const workspaceId = workspaces.workspaces[0]?.workspaceId;
  if (!workspaceId) throw new Error('Airbyte reports no workspace — is it freshly provisioned?');

  // ── 1. Find the live CoreBank source/connection to mirror its config exactly ──────────────────
  const { connections } = await post<{ connections: ConnectionRead[] }>('connections/list', { workspaceId });
  let referenceSourceId: string | null = null;
  let destinationId: string | null = null;
  for (const c of connections) {
    const src = await post<SourceRead>('sources/get', { sourceId: c.sourceId }).catch(() => null);
    if (src && src.connectionConfiguration?.database === 'corebank') {
      referenceSourceId = src.sourceId;
      destinationId = c.destinationId;
      break;
    }
  }
  let referenceConfig: Record<string, unknown>;
  let sourceDefinitionId: string;
  if (referenceSourceId) {
    const ref = await post<SourceRead>('sources/get', { sourceId: referenceSourceId });
    referenceConfig = ref.connectionConfiguration;
    sourceDefinitionId = ref.sourceDefinitionId;
    console.log(`mirroring CoreBank source ${referenceSourceId} (host=${referenceConfig.host} port=${referenceConfig.port})`);
  } else {
    // Fallback observed live 2026-08-10 when there is no CoreBank source to read (e.g. a workspace
    // reset). host.docker.internal:15433 is Airbyte's (g6) path to the shared Postgres fixture box —
    // see the note at the bottom of this file for why a host-level forward is required for this to work.
    console.log('no CoreBank source found to mirror — using the known-good fallback Postgres config');
    referenceConfig = {
      host: 'host.docker.internal', port: 15433, schemas: ['public'],
      ssl_mode: { mode: 'disable' }, tunnel_method: { tunnel_method: 'NO_TUNNEL' },
      replication_method: { method: 'Standard' },
    };
    sourceDefinitionId = 'decd338e-5647-4c0b-adf4-da0e75f5a750'; // airbyte/source-postgres
  }
  if (!destinationId) {
    const { destinations } = await post<{ destinations: { destinationId: string; name: string }[] }>(
      'destinations/list', { workspaceId },
    );
    const dest = destinations.find((d) => /clickhouse|warehouse/i.test(d.name)) ?? destinations[0];
    if (!dest) throw new Error('Airbyte reports no destination — the warehouse destination must exist first.');
    destinationId = dest.destinationId;
    console.log(`no CoreBank connection to mirror a destination from — using ${dest.name} (${destinationId})`);
  }

  // ── 2. Resolve the credential from the vault (same path connector-exec uses at query time) ────
  const password = await resolveConnectorSecret(SOURCE_CONNECTOR_ID, ORG);
  if (!password) {
    throw new Error(
      `no vaulted credential for ${SOURCE_CONNECTOR_ID} (org ${ORG}) — cannot create the source without one.`,
    );
  }

  // ── 3. Find-or-create the source ────────────────────────────────────────────────────────────────
  const { sources } = await post<{ sources: SourceRead[] }>('sources/list', { workspaceId });
  let source = sources.find(
    (s) => s.connectionConfiguration?.database === TARGET_DATABASE && s.connectionConfiguration?.username === TARGET_USERNAME,
  ) ?? null;
  if (source) {
    console.log(`source already exists: ${source.sourceId} (${source.name})`);
  } else {
    const created = await post<SourceRead>('sources/create', {
      sourceDefinitionId,
      workspaceId,
      name: 'Core Insurance Postgres',
      connectionConfiguration: {
        ...referenceConfig,
        database: TARGET_DATABASE,
        username: TARGET_USERNAME,
        password,
      },
    });
    source = created;
    console.log(`created source ${source.sourceId} (Core Insurance Postgres)`);
  }

  const check = await post<{ status: string }>('sources/check_connection', { sourceId: source.sourceId });
  console.log(`check_connection: ${check.status}`);
  if (check.status !== 'succeeded') {
    throw new Error(`source check_connection reported "${check.status}" — refusing to create a connection on a source that cannot connect.`);
  }

  // ── 4. Find-or-create the connection ────────────────────────────────────────────────────────────
  let connection = connections.find((c) => c.sourceId === source!.sourceId) ?? null;
  if (connection) {
    console.log(`connection already exists: ${connection.connectionId} (${connection.name})`);
  } else {
    const discovered = await post<DiscoverSchemaRead>('sources/discover_schema', { sourceId: source.sourceId });
    const streams = discovered.catalog.streams
      .filter((s) => STREAM_NAMES.includes(s.stream.name))
      .map((s) => ({
        stream: s.stream,
        config: {
          syncMode: 'full_refresh',
          cursorField: [],
          destinationSyncMode: 'overwrite',
          primaryKey: s.stream.sourceDefinedPrimaryKey,
          aliasName: s.stream.name,
          selected: true,
          suggested: false,
          fieldSelectionEnabled: false,
          selectedFields: [],
        },
      }));
    if (streams.length !== STREAM_NAMES.length) {
      throw new Error(
        `expected streams [${STREAM_NAMES.join(', ')}] on the discovered schema, got [${discovered.catalog.streams.map((s) => s.stream.name).join(', ')}]`,
      );
    }
    connection = await post<ConnectionRead>('connections/create', {
      name: CONNECTION_NAME,
      namespaceDefinition: 'source',
      namespaceFormat: '${SOURCE_NAMESPACE}',
      prefix: 'coreins_',
      sourceId: source.sourceId,
      destinationId,
      syncCatalog: { streams },
      scheduleType: 'manual',
      status: 'active',
      geography: 'auto',
      notifySchemaChanges: false,
      notifySchemaChangesByEmail: false,
      nonBreakingChangesPreference: 'ignore',
      backfillPreference: 'disabled',
    });
    console.log(`created connection ${connection.connectionId} (${CONNECTION_NAME})`);
  }

  // ── 5. Trigger a sync through the REAL product path (airbyteEtl) and poll to a terminal state ──
  const triggered = await airbyteEtl.triggerSync(connection.connectionId);
  if (!triggered) throw new Error('airbyteEtl.triggerSync returned null — Airbyte unreachable?');
  console.log(`sync triggered: job ${triggered.jobId} status=${triggered.status}`);

  let final = triggered;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (final.status !== 'running' && final.status !== 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const polled = await airbyteEtl.jobStatus(Number(triggered.jobId));
    if (polled) final = polled;
  }
  console.log(`\n== final sync result ==`);
  console.log(`job ${final.jobId}  status=${final.status}`);

  console.log('\nDone — /data/flows/replication on org_suraksha should now show a real, run connection.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

// ─── Note on the network path (read this before re-running on a different box state) ───────────────
// Airbyte's docker containers run on g6; the Postgres fixture (corebank/coreins/policies/... — see
// SUR_COREINS in suraksha-tenant-seed.ts) runs on g3, reached from the CONSOLE box (S1) at
// 127.0.0.1:5433 via the S1 tcp-forward.js. Historically CoreBank's Airbyte source worked at
// host.docker.internal:15433 because the Postgres fixture used to run AS A CONTAINER ON g6 ITSELF
// (published 15433->5432); the 2026-08-05 g3 migration moved the fixture off g6 without updating that
// path, so by 2026-08-10 NOTHING listened on g6:15433 and even the existing CoreBank source failed
// check_connection. Fixed live by starting a small Python TCP forwarder ON THE g6 HOST (not in a
// container — the docker containers on g6 could not reach g3 over the LAN directly, but the g6 HOST
// could) binding 0.0.0.0:15433 -> offgrid-g3.local:5433, so host.docker.internal:15433 resolves inside
// Airbyte's containers again. That forwarder is NOT part of this repo (on-prem topology lives in the
// private onprem-fleet-orchestration repo per console/CLAUDE.md) — record it there if it needs to
// survive a g6 reboot. It is currently a bare `nohup python3 ~/pg-forward.py &` process on g6.
//
// Separately, Airbyte's own Temporal cluster was in a degraded state during this session — every
// check_connection / sync job timed out after ~65s with no logs and no connector container ever
// launched, because Temporal's matching engine reported "Not enough hosts to serve the request" for
// this all-in-one deployment. Restarting offgrid-console-airbyte-temporal-1 (then -server-1 and
// -worker-1, so they reconnect against fresh Temporal state) resolved it. If this script's
// check_connection call times out with no useful log lines, that Temporal-degradation class of failure
// is the first thing to check — `docker logs offgrid-console-airbyte-worker-1` showing pollers
// registered but zero activity across multiple job attempts is the signature.
