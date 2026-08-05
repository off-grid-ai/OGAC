// ─── Stream trigger adapter — the INBOUND half of triggers-in → governed run → sinks-out ─────────
//
// A record arriving on a topic starts a governed app-run, exactly as an inbound webhook does. The
// outbound half already existed (SINK_REGISTRY.topic publishes a governed output through the egress
// leash → mask → deliver → record sequence); this closes the loop.
//
// THE ORDER OF OPERATIONS IS THE FEATURE:
//
//     read a window → decide (pure) → submit the governed run → RECORD IT DURABLY → advance the cursor
//
// Never the other way round. Advancing the cursor first would acknowledge work that a crash could
// then erase — the record leaves our view and no run exists, and nobody finds out, because the
// symptom is silence. Doing it in this order can duplicate instead, which the delivery ledger then
// suppresses, and which is recoverable in a way that a lost customer instruction is not.
//
// SOLID: every decision here is made by pure, tested code — planTopicConsume / dispositionFor /
// mayCommitOffset / advanceCursor in topic-trigger-policy.ts. This file is the I/O bridge: broker in,
// submitAppRun out, Postgres for progress. It reuses createKafkaWindowReader rather than opening a
// second consumer, so the governed connector read and this share one delivery guarantee.

import { createKafkaWindowReader } from '@/lib/adapters/kafka-enterprise-source';
import { submitAppRun } from '@/lib/adapters/apprun';
import { resolveRedpandaConfig } from '@/lib/adapters/redpanda';
import type { AppSpec } from '@/lib/app-model';
import { newAppRunId } from '@/lib/app-run';
import { listStreamTriggeredApps } from '@/lib/apps-store';
import { buildTriggerInput } from '@/lib/trigger-dispatch';
import {
  advanceCursor,
  deliveryKey,
  dispositionFor,
  mayCommitOffset,
  parseTopicTriggerConfig,
  planTopicConsume,
  type StreamRecord,
} from '@/lib/topic-trigger-policy';
import {
  commitTopicCursor,
  readSeenDeliveries,
  readTopicCursors,
  recordDelivery,
} from '@/lib/topic-trigger-store';

export interface AppCycleResult {
  appId: string;
  topic: string;
  read: number;
  ran: number;
  duplicates: number;
  parked: number;
  failed: number;
  /** Partitions started at the live edge this cycle — the operator is told history was not replayed. */
  initialised: number;
  /** Records deleted by retention before we reached them. Never silent. */
  lost: number;
  errors: string[];
}

export interface TopicPollResult {
  configured: boolean;
  apps: number;
  cycles: AppCycleResult[];
  errors: string[];
  note?: string;
}

/**
 * Is a broker configured on this deployment?
 *
 * Same air-gap shape as the email trigger: no default broker, no discovery. Nothing is consumed
 * unless the operator explicitly set OFFGRID_REDPANDA_BROKERS.
 */
export function isTopicTriggerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRedpandaConfig(env).brokers.length > 0;
}

/**
 * One poll cycle across every published stream-triggered app. Graceful: an app that fails is
 * reported and the others still run, because one broken trigger must not stop the deployment's work.
 */
export async function pollTopicTriggers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TopicPollResult> {
  const config = resolveRedpandaConfig(env);
  if (config.brokers.length === 0) {
    return {
      configured: false,
      apps: 0,
      cycles: [],
      errors: [],
      note: 'Stream triggers are disabled — set OFFGRID_REDPANDA_BROKERS to your on-prem broker to enable.',
    };
  }

  const errors: string[] = [];
  let apps: AppSpec[] = [];
  try {
    apps = await listStreamTriggeredApps();
  } catch (e) {
    // A failed lookup is NOT "no apps are listening". Reported as an error so a database outage can
    // never be read off this result as a quiet, healthy, idle cycle.
    return { configured: true, apps: 0, cycles: [], errors: [`app lookup failed: ${msg(e)}`] };
  }

  const cycles: AppCycleResult[] = [];
  for (const app of apps) {
    try {
      cycles.push(await runAppCycle(app, config));
    } catch (e) {
      errors.push(`app ${app.id}: ${msg(e)}`);
    }
  }
  return { configured: true, apps: apps.length, cycles, errors };
}

type RedpandaConfig = ReturnType<typeof resolveRedpandaConfig>;

async function runAppCycle(app: AppSpec, config: RedpandaConfig): Promise<AppCycleResult> {
  const parsed = parseTopicTriggerConfig(app.trigger?.config ?? {});
  if (!parsed.ok) {
    // The same pure policy validateTrigger uses, so a trigger that saved cleanly cannot be refused
    // here. If it ever is, the config was written around the form and the reason is stated.
    return { ...empty(app.id, ''), errors: [parsed.sentence] };
  }
  const { topic, groupId } = parsed.config;
  const out = empty(app.id, topic);

  // The client id carries the group so a broker-side view of connections is attributable to the app
  // that owns them. We do not join a broker consumer group: our cursor is authoritative, precisely so
  // that acknowledgement follows durability rather than delivery.
  const reader = createKafkaWindowReader({
    clientId: `${config.clientId}-trigger-${groupId}`.slice(0, 240),
    brokers: [...config.brokers],
    tls: false,
  });

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('stream read timed out')), 30_000);
  let records: StreamRecord[] = [];
  let plan: ReturnType<typeof planTopicConsume>;
  try {
    const partitions = await reader.topicPartitions(topic, controller.signal);
    const cursors = await readTopicCursors(app.id, topic);
    plan = planTopicConsume(partitions, cursors);
    out.initialised = plan.initialised.length;
    out.lost = plan.lost.length;
    for (const l of plan.lost) {
      out.errors.push(
        `partition ${l.partition}: ${l.missed} record(s) were removed by the stream's retention window before this app read them.`,
      );
    }
    // Initialising is a WRITE: without it, every cycle re-discovers the partition as unseen and the
    // app never consumes anything at all.
    for (const init of plan.initialised) {
      await commitTopicCursor({
        appId: app.id,
        orgId: app.orgId,
        topic,
        groupId,
        partition: init.partition,
        nextOffset: init.nextOffset,
      });
    }
    // A lost range is committed too, or the same loss is re-reported every cycle forever.
    for (const l of plan.lost) {
      await commitTopicCursor({
        appId: app.id, orgId: app.orgId, topic, groupId, partition: l.partition, nextOffset: l.to,
      });
    }
    if (plan.windows.length === 0) return out;

    const raw = await reader.readWindows({
      topic,
      groupId,
      windows: plan.windows,
      signal: controller.signal,
    });
    records = raw.map((r) => ({
      topic,
      partition: r.partition,
      offset: r.offset,
      key: r.key ? r.key.toString('utf8') : null,
      value: r.value.toString('utf8'),
    }));
  } finally {
    clearTimeout(deadline);
  }
  out.read = records.length;
  if (records.length === 0) return out;

  const seen = await readSeenDeliveries(app.id, records.map(deliveryKey));
  // Per partition, so one poisoned record stops ITS partition's cursor and not the whole topic's.
  const cursor = new Map<number, string>();
  const halted = new Set<number>();

  for (const rec of records) {
    // A partition stops at its first uncommittable record: ordering within a partition is a promise
    // we keep, so nothing after it may be acknowledged. Other partitions carry on — one bad record
    // must not stall an entire topic.
    if (halted.has(rec.partition)) continue;
    const d = dispositionFor(rec, seen);
    let persisted = false;
    try {
      if (d.act === 'run') {
        const runId = newAppRunId();
        // The governed entry point every trigger shares: pipeline binding, policy, guardrails,
        // grounding and signing all apply. There is no stream-specific shortcut around it.
        await submitAppRun(app, buildTriggerInput('topic', rec), {
          orgId: app.orgId,
          actor: 'trigger:topic',
          runId,
          // The run records WHAT started it, naming the feed. Without this the run reads as though a
          // person clicked it, and "did a human ask for this?" is the first question of any review.
          trigger: { kind: 'topic', config: { topic, groupId } },
        });
        await recordDelivery({
          appId: app.id, orgId: app.orgId, deliveryKey: d.key, disposition: 'ran', runId,
        });
        seen.add(d.key);
        persisted = true;
        out.ran++;
      } else {
        await recordDelivery({
          appId: app.id,
          orgId: app.orgId,
          deliveryKey: d.key,
          disposition: d.act === 'park' ? 'parked' : 'duplicate',
          note: d.reason,
        });
        if (d.act === 'park') out.parked++;
        else out.duplicates++;
      }
    } catch (e) {
      out.failed++;
      out.errors.push(`${d.key}: ${msg(e)}`);
      // Best-effort: the failure is retained so a record that never runs is visible rather than
      // merely absent. If even this write fails the cursor stays put and the record is redelivered.
      await recordDelivery({
        appId: app.id, orgId: app.orgId, deliveryKey: d.key, disposition: 'failed', note: msg(e),
      }).catch(() => undefined);
    }

    if (!mayCommitOffset(d, persisted)) {
      // Advancing past a record whose run is not recorded would drop it. Redelivery next cycle.
      halted.add(rec.partition);
      continue;
    }
    cursor.set(rec.partition, advanceCursor(cursor.get(rec.partition), rec.offset));
  }

  for (const [partition, nextOffset] of cursor) {
    await commitTopicCursor({ appId: app.id, orgId: app.orgId, topic, groupId, partition, nextOffset });
  }
  return out;
}

function empty(appId: string, topic: string): AppCycleResult {
  return {
    appId, topic, read: 0, ran: 0, duplicates: 0, parked: 0, failed: 0,
    initialised: 0, lost: 0, errors: [],
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
