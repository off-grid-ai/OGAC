// ─── A stream record as a governed trigger ──────────────────────────────────────────────────────────
//
// The capability map's gap for stream consume is NOT "never proven" — the primitives were proven on
// 2026-07-20 and again in a full drill. It says *"no registered source pipeline does"*. The gap is
// BINDING: a topic that arrives has to start a governed run the same way an inbound webhook does.
//
// The outbound half already exists (`SINK_REGISTRY.topic` publishes a governed app output through the
// same egress leash → mask → deliver → record sequence as every other sink). This is the inbound half,
// completing triggers-in → governed run → sinks-out.
//
// THE DECISION THAT MATTERS HERE IS DELIVERY SEMANTICS, and it is why this is a policy module rather
// than a few lines in a consumer loop:
//
//   • A broker offset must NOT be committed until the run it caused is durably recorded. Commit-then-run
//     silently DROPS enterprise work on a crash — the record is gone from the queue and no run exists.
//     Run-then-commit can duplicate instead, which is recoverable; losing a customer's instruction is not.
//   • So duplicates are expected by design, and every record needs a stable identity to suppress them.
//     A broker guarantees (topic, partition, offset) is unique and stable; a payload hash does not
//     distinguish two genuinely identical instructions sent twice on purpose.
//
// Pure. Zero IO.

/** A record as handed over by the broker adapter. */
export interface StreamRecord {
  topic: string;
  partition: number;
  /** Broker offsets exceed 2^53 on busy topics, so they are carried as strings, never numbers. */
  offset: string;
  key?: string | null;
  value: string;
}

export interface TopicTriggerConfig {
  /** The topic to consume. Never defaulted — a consumer that guesses its topic reads the wrong data. */
  topic: string;
  /**
   * Consumer group. Required: without one, two console processes each consume every record and every
   * message runs twice, which looks exactly like a duplicate-delivery bug and is not one.
   */
  groupId: string;
}

export type ConfigProblem =
  | 'topic-missing'
  | 'topic-invalid'
  | 'group-missing'
  | 'group-invalid';

/** Broker-legal topic/group names. Kept strict: an illegal name fails at subscribe time, far from here. */
const NAME = /^[a-zA-Z0-9._-]+$/;
const MAX_NAME = 249;

export type ConfigResult =
  | { ok: true; config: TopicTriggerConfig }
  | { ok: false; problems: ConfigProblem[]; sentence: string };

const PROBLEM_COPY: Record<ConfigProblem, string> = {
  'topic-missing': 'no topic is named, so there is nothing to listen to',
  'topic-invalid': 'the topic name uses characters a broker will reject',
  'group-missing':
    'no consumer group is named — without one every console process would consume every record and the work would run more than once',
  'group-invalid': 'the consumer group name uses characters a broker will reject',
};

/**
 * Validate a topic trigger's configuration.
 *
 * ALL problems are returned, not the first: an operator fixing one field at a time through a form is
 * the slowest possible way to configure a trigger.
 */
export function parseTopicTriggerConfig(raw: unknown): ConfigResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const topic = typeof o.topic === 'string' ? o.topic.trim() : '';
  const groupId = typeof o.groupId === 'string' ? o.groupId.trim() : '';
  const problems: ConfigProblem[] = [];

  if (!topic) problems.push('topic-missing');
  else if (!NAME.test(topic) || topic.length > MAX_NAME) problems.push('topic-invalid');
  if (!groupId) problems.push('group-missing');
  else if (!NAME.test(groupId) || groupId.length > MAX_NAME) problems.push('group-invalid');

  if (problems.length > 0) {
    return {
      ok: false,
      problems,
      sentence: `This stream trigger cannot run: ${problems.map((p) => PROBLEM_COPY[p]).join('; ')}.`,
    };
  }
  return { ok: true, config: { topic, groupId } };
}

/**
 * The stable identity of a delivery.
 *
 * (topic, partition, offset) — the only triple a broker guarantees is unique and stable for a record.
 * NOT the payload: two identical instructions sent deliberately are two units of work, and collapsing
 * them would silently drop one.
 */
export function deliveryKey(rec: Pick<StreamRecord, 'topic' | 'partition' | 'offset'>): string {
  return `${rec.topic}/${rec.partition}/${rec.offset}`;
}

export type Disposition =
  | { act: 'run'; key: string }
  /** Already ran. The offset still has to be committed, or it is redelivered forever. */
  | { act: 'skip-duplicate'; key: string; reason: string }
  /** Unusable record. Committed so it cannot block the partition, and recorded so it is not invisible. */
  | { act: 'park'; key: string; reason: string };

/**
 * What to do with one delivered record.
 *
 * `seen` is the set of delivery keys already processed. Duplicates are EXPECTED — see the header: we
 * commit after the run is durable, so a crash between the two redelivers.
 */
export function dispositionFor(
  rec: StreamRecord,
  seen: ReadonlySet<string>,
  maxValueBytes = 1_000_000,
): Disposition {
  const key = deliveryKey(rec);
  if (seen.has(key)) {
    return {
      act: 'skip-duplicate',
      key,
      reason: 'This record was already processed; it was redelivered because its offset was not committed.',
    };
  }
  if (rec.value.trim() === '') {
    // A tombstone/empty value is legitimate on a broker but cannot be work. Parked, not silently dropped.
    return { act: 'park', key, reason: 'The record carries no value, so there is nothing to act on.' };
  }
  // Byte length, not string length: a 400k-character payload of multibyte text is over a 1MB cap.
  const bytes = Buffer.byteLength(rec.value, 'utf8');
  if (bytes > maxValueBytes) {
    return {
      act: 'park',
      key,
      reason: `The record is ${bytes} bytes, over the ${maxValueBytes}-byte limit for a single trigger.`,
    };
  }
  return { act: 'run', key };
}

/**
 * May this offset be committed yet?
 *
 * THE RULE THIS MODULE EXISTS FOR. A commit says "this work is done and need never be redelivered", so
 * it may only follow a run that is DURABLY RECORDED. `runPersisted` is not "the run finished" — it is
 * "the console can still see the run after a restart". Committing on an in-memory success is how a
 * crash turns an instruction into nothing at all.
 */
export function mayCommitOffset(d: Disposition, runPersisted: boolean): boolean {
  if (d.act === 'run') return runPersisted;
  // Duplicates and parked records must commit, or the partition is stuck redelivering them forever.
  return true;
}

/** One line for the trigger's surface, in the reader's language rather than the broker's. */
export function describeTopicTrigger(config: TopicTriggerConfig, brokerConfigured: boolean): string {
  if (!brokerConfigured) {
    return `This app would start when a record arrives on “${config.topic}”, but no stream connection is configured on this deployment, so nothing is listening yet.`;
  }
  return `This app starts a governed run whenever a record arrives on “${config.topic}”. Records are processed once each, and one that fails is retried rather than lost.`;
}
