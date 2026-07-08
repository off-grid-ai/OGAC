// DSAR propagation — DEVICE-REPLICA adapter. Thin I/O over the tombstone queue store.
//
// The server can't reach an offline device to delete synchronously, so "propagating to devices" means
// recording a durable, pullable TOMBSTONE ("forget subject X") that devices apply on next sync and
// acknowledge. That queue IS the device channel — it's always available (a Postgres table), so the
// device target is always actionable: we never silently skip. The tombstone is the honest, recorded
// propagation request.
//
// SOLID: the rule (that this target runs) is the pure planner's; this file only writes the row.

import { recordTombstone } from '@/lib/erasure-tombstone-store';

export interface DeviceEraseResult {
  ok: boolean;
  /** 1 when a tombstone was recorded (a queued propagation request). */
  removed: number;
  /** The tombstone id, for the audit trail. */
  tombstoneId: string | null;
  error: string | null;
}

/**
 * Record a device-erasure tombstone for the subject. Returns an honest result — a recorded tombstone
 * counts as a real propagation REQUEST (removed:1), NOT as on-device data actually deleted; the caller
 * reports it accordingly (it becomes `erased` in the sense "the propagation request is durably queued").
 * On a DB failure returns ok:false so the orchestrator defers it.
 */
export async function eraseSubjectDeviceReplicas(
  subjectKey: string,
  requestedBy: string,
  orgId: string,
): Promise<DeviceEraseResult> {
  try {
    const t = await recordTombstone(subjectKey, requestedBy, orgId);
    return { ok: true, removed: 1, tombstoneId: t.id, error: null };
  } catch (e) {
    return { ok: false, removed: 0, tombstoneId: null, error: e instanceof Error ? e.message : 'device tombstone failed' };
  }
}
