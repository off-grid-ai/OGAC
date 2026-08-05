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

// ─── Where to read from: the cursor plan ────────────────────────────────────────────────────────
//
// The consumer does NOT let the broker track its own progress. Broker-side auto-commit acknowledges a
// record when it is *delivered*, which is precisely the commit-before-durable failure this module
// exists to prevent. So the cursor is ours, stored beside the runs it accounts for, and this function
// decides what to read next from it.

/** What the broker reports for one partition. `highOffset` is the log end — one PAST the last record. */
export interface PartitionState {
  partition: number;
  lowOffset: string;
  highOffset: string;
}

/** Our own progress: the first offset NOT yet processed. Absent means this partition is unseen. */
export interface PartitionCursor {
  partition: number;
  nextOffset: string;
}

export interface ReadWindow {
  partition: number;
  fromOffset: string;
  toOffset: string;
}

export interface ConsumePlan {
  windows: ReadWindow[];
  /**
   * Partitions started at the live edge because this trigger had never consumed them.
   * Surfaced, not silent: an operator who expected history to replay must be told it did not.
   */
  initialised: Array<{ partition: number; nextOffset: string }>;
  /** Partitions whose cursor fell behind retention — records were deleted before we read them. */
  lost: Array<{ partition: number; from: string; to: string; missed: string }>;
}

export const MAX_RECORDS_PER_CYCLE = 200;

/**
 * Plan the next read.
 *
 * THE DEFAULT THAT MATTERS: a partition we have never consumed starts at the LIVE EDGE, not at the
 * beginning. "This app starts when a record arrives" must not mean "and it will now process the last
 * six months of them" — turning on a trigger would fire thousands of governed runs, which on a topic
 * carrying customer instructions is an incident, not a backfill.
 *
 * All offset arithmetic is BigInt: broker offsets pass 2^53 and Number would silently round.
 */
export function planTopicConsume(
  partitions: readonly PartitionState[],
  cursors: readonly PartitionCursor[],
  maxRecords = MAX_RECORDS_PER_CYCLE,
): ConsumePlan {
  const at = new Map(cursors.map((c) => [c.partition, c.nextOffset]));
  const plan: ConsumePlan = { windows: [], initialised: [], lost: [] };
  const budget = BigInt(Math.max(0, maxRecords));

  // Pass 1 — establish where each partition stands. No budget is spent yet, because spending it in
  // partition order would let a busy partition 0 consume the whole cycle forever and STARVE the rest:
  // a record on partition 3 would then wait indefinitely for one that never goes quiet.
  const ready: Array<{ partition: number; next: bigint; available: bigint }> = [];
  for (const p of [...partitions].sort((a, b) => a.partition - b.partition)) {
    const low = BigInt(p.lowOffset);
    const high = BigInt(p.highOffset);
    const known = at.get(p.partition);

    if (known === undefined) {
      plan.initialised.push({ partition: p.partition, nextOffset: p.highOffset });
      continue;
    }

    let next = BigInt(known);
    if (next < low) {
      // Retention deleted records we had not read. We cannot invent them; we CAN refuse to hide it.
      plan.lost.push({
        partition: p.partition,
        from: known,
        to: p.lowOffset,
        missed: (low - next).toString(),
      });
      next = low;
    }
    if (next >= high) continue; // caught up
    ready.push({ partition: p.partition, next, available: high - next });
  }
  if (ready.length === 0 || budget <= 0n) return plan;

  // Pass 2 — an equal share each, so every partition makes progress every cycle.
  const share = budget / BigInt(ready.length);
  let spare = budget % BigInt(ready.length);
  const take = new Map<number, bigint>();
  let unused = 0n;
  for (const r of ready) {
    let allot = share;
    if (spare > 0n) {
      allot += 1n;
      spare -= 1n;
    }
    const t = r.available < allot ? r.available : allot;
    unused += allot - t;
    take.set(r.partition, t);
  }
  // Pass 3 — hand back what quiet partitions did not need, so a small budget is never left on the
  // table while a busy partition has a backlog.
  for (const r of ready) {
    if (unused <= 0n) break;
    const room = r.available - take.get(r.partition)!;
    if (room <= 0n) continue;
    const extra = room < unused ? room : unused;
    take.set(r.partition, take.get(r.partition)! + extra);
    unused -= extra;
  }

  for (const r of ready) {
    const t = take.get(r.partition)!;
    if (t <= 0n) continue;
    plan.windows.push({
      partition: r.partition,
      fromOffset: r.next.toString(),
      toOffset: (r.next + t - 1n).toString(),
    });
  }
  return plan;
}

/**
 * Move a cursor past a record that is finished with.
 *
 * Monotonic on purpose: a late or out-of-order acknowledgement must never rewind the cursor, because
 * rewinding re-runs governed work that already ran.
 */
export function advanceCursor(current: string | undefined, offset: string): string {
  const after = BigInt(offset) + 1n;
  if (current === undefined) return after.toString();
  const now = BigInt(current);
  return (after > now ? after : now).toString();
}

/** One line for the trigger's surface, in the reader's language rather than the broker's. */
export function describeTopicTrigger(config: TopicTriggerConfig, brokerConfigured: boolean): string {
  if (!brokerConfigured) {
    return `This app would start when a record arrives on “${config.topic}”, but no stream connection is configured on this deployment, so nothing is listening yet.`;
  }
  return `This app starts a governed run whenever a record arrives on “${config.topic}”. Records are processed once each, and one that fails is retried rather than lost.`;
}
