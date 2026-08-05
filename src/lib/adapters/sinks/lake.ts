// ─── Outbound sink: save a governed run's outcome into the object store ──────────────────────────
//
// The capability-map gap for the S3 data lake, read correctly. SeaweedFS has served objects the whole
// time and the console's own lake screens read and write them. What did not exist was a PRODUCT path:
// a governed app output that lands in the lake under the tenant's approved scope. The read half
// (connector-query on an s3 domain) already existed; this is the write half, so "governed object
// read/write" is one loop rather than two halves of a sentence.
//
// THE DESTINATION IS NOT CONFIGURABLE, and that is the point. Every other sink names where it sends —
// a URL, a channel, a topic. An object store is different: the connector's keypair can usually reach
// the whole store, so a bucket taken from step config would let anyone who can edit an app write
// anywhere that keypair reaches, INCLUDING over the app's own source data. So the step names a DATA
// DOMAIN — the thing that already carries an approved bucket and prefix — and a bare file name.
//
// AIR-GAPPED: the store is on the customer's own network, so no cloud egress leash applies. PII
// masking still does, and it matters more here than for a message: an object PERSISTS, and whatever
// lands in it is read by every later consumer of that bucket. The masking happens upstream in
// planSinkGovernance; by the time this runs, `body` is already the governed text.

import { writeGovernedObject } from '@/lib/adapters/s3-object-query';
import { planObjectSink, type ObjectSinkConfig } from '@/lib/object-sink-policy';

export interface LakeSaveResult {
  ok: boolean;
  /** False when the step names no data domain — an honest degrade, never a fake success. */
  configured: boolean;
  reason: string;
  key?: string;
  bytes?: number;
}

/**
 * Save one governed outcome into an approved data domain.
 *
 * Resolving the domain to a connector is a lookup, not a guess: the domain must belong to this org and
 * be bound to an s3 connector, or the write is refused. A step pointing at a domain the tenant does not
 * own fails closed with a reason, rather than falling back to some default bucket.
 */
export async function saveToLake(
  cfg: ObjectSinkConfig,
  ctx: { runId: string; orgId: string; body: string },
): Promise<LakeSaveResult> {
  const plan = planObjectSink(cfg, ctx.runId);
  if (!plan.ok) {
    // `configured: false` for a missing domain (the app was never pointed anywhere) but a genuine
    // failure for a bad file name — the author asked for something specific and it was refused.
    return {
      ok: false,
      configured: plan.problem !== 'domain-missing',
      reason: plan.sentence,
    };
  }

  const { listDomains } = await import('@/lib/data-domains-store');
  const domains = await listDomains(ctx.orgId);
  const domain = domains.find((d) => d.id === cfg.domain || d.label === cfg.domain);
  if (!domain?.connectorId) {
    return {
      ok: false,
      configured: false,
      reason: `no data location named “${cfg.domain}” is available to this workspace`,
    };
  }

  const written = await writeGovernedObject({
    orgId: ctx.orgId,
    connectorId: domain.connectorId,
    domainId: domain.id,
    filename: plan.filename,
    body: ctx.body,
    contentType: plan.contentType,
  });
  if (!written.ok) {
    return { ok: false, configured: true, reason: written.error.message };
  }
  return {
    ok: true,
    configured: true,
    reason: `saved to ${written.result.domainLabel} as ${written.result.key}`,
    key: written.result.key,
    bytes: written.result.bytes,
  };
}
