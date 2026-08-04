// ─── Outbound sink: publish a governed run's outcome to a stream topic ────────────────────────────────
//
// This is the capability-map gap for Redpanda's producer, read correctly. The gap was never "the producer
// does not work" — the primitives were fleet-proven on 2026-07-20 and I re-proved them by hand. It was:
//
//     "no general pipeline output uses this adapter"
//
// So the close is a BINDING, not another drill: a governed app output step that publishes to a topic, under
// exactly the same sequence every other outbound sink runs (egress leash → PII mask → deliver → honest
// record). It reuses the existing sink registry rather than adding a parallel path, which is why there is
// no governance logic in this file at all.
//
// AIR-GAPPED, like the WhatsApp gateway. The broker is on the customer's own network (127.0.0.1 on the
// audited deployment), so no cloud egress leash applies — but the PII masking still does, because a record
// on a topic is read by other systems and people, and "internal" is not "unprotected".

import { Kafka } from 'kafkajs';

export interface TopicSinkConfig {
  /** Topic to publish to. */
  topic?: string;
  /** Optional record key — defaults to the run id so records for one case land in order on one partition. */
  key?: string;
}

export interface TopicSendResult {
  ok: boolean;
  /** False when no broker is configured — an honest degrade, never a fake success. */
  configured: boolean;
  reason: string;
  /** Partition and offset: the broker's own receipt that it accepted the record. */
  partition?: number;
  offset?: string;
}

function brokers(): string[] {
  return (process.env.OFFGRID_REDPANDA_BROKERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Publish one governed outcome to a topic.
 *
 * Never auto-creates the topic. A sink that silently conjures a destination hides a misconfigured app —
 * the operator asked for a topic that should already be provisioned, and being told it does not exist is
 * the useful answer.
 *
 * The returned partition/offset is the broker's acknowledgement, and it becomes the delivery receipt the
 * run retains. Without it "sent" would be our word for it rather than the broker's.
 */
export async function sendToTopic(
  cfg: TopicSinkConfig,
  ctx: { runId: string; orgId: string; appId: string; outcome: string },
): Promise<TopicSendResult> {
  const list = brokers();
  const topic = (cfg.topic ?? '').trim();
  if (list.length === 0) {
    return { ok: false, configured: false, reason: 'no stream broker is configured for this deployment' };
  }
  if (!topic) {
    return { ok: false, configured: false, reason: 'this step names no topic to publish to' };
  }

  const kafka = new Kafka({ clientId: process.env.OFFGRID_REDPANDA_CLIENT_ID ?? 'offgrid-console', brokers: list, retry: { retries: 2 } });
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  try {
    await producer.connect();
    const res = await producer.send({
      topic,
      messages: [
        {
          // The run id as key, so every record about one case shares a partition and therefore an order.
          key: (cfg.key ?? '').trim() || ctx.runId,
          value: JSON.stringify({
            runId: ctx.runId,
            appId: ctx.appId,
            orgId: ctx.orgId,
            // Already masked by the shared sink governance before it reaches here.
            outcome: ctx.outcome,
          }),
        },
      ],
    });
    const first = res[0];
    if (!first || first.errorCode !== 0) {
      return {
        ok: false,
        configured: true,
        reason: `the broker rejected the record (error ${first?.errorCode ?? 'unknown'})`,
      };
    }
    return {
      ok: true,
      configured: true,
      reason: `published to ${topic}`,
      partition: first.partition,
      offset: String(first.baseOffset ?? ''),
    };
  } catch (err) {
    // The CAUSE matters here — "unknown topic" and "cannot reach broker" need different fixes.
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, configured: true, reason: `could not publish to ${topic}: ${msg.slice(0, 180)}` };
  } finally {
    await producer.disconnect().catch(() => {});
  }
}
