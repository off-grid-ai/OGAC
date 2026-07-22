// ─── Analytical-model SERVICE — the live apply/rollback/delete orchestration ──
// The thin I/O seam that makes a governed analytical model REAL end-to-end: it takes a pure PLAN
// (src/lib/schema-model.ts decides WHAT DDL runs), executes it against ClickHouse through the
// warehouse adapter (src/lib/adapters/warehouse.ts does the HTTP I/O), and records the version +
// exact DDL in the console-owned store (src/lib/schema-model-store.ts). No decision lives here — it
// only sequences the three seams and orders the effect so the store never records a version whose
// DDL didn't actually apply to the warehouse.
//
// The warehouse port is injected (defaulting to the live ClickHouse adapter) so the sequencing is
// testable against a real Postgres store + a stub at the external device boundary — the port is the
// warehouse's edge, not our own logic.
import { clickhouseWarehouse, type WarehousePort } from '@/lib/adapters/warehouse';
import {
  nextVersion,
  planModelApply,
  planModelDrop,
  planRollback,
  type ModelDefinition,
  type ModelInput,
  type ModelKind,
} from '@/lib/schema-model';
import {
  addModelVersion,
  createModel,
  deleteModel,
  getModel,
  setCurrentVersion,
  type SchemaModel,
  type SchemaModelDetail,
} from '@/lib/schema-model-store';

// A discriminated result the routes translate to HTTP via schema-model's pure serviceErrorStatus /
// serviceErrorMessage: validation failure (422), not-found (404), warehouse-exec failure (502), or
// success with the fresh model detail.
export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'invalid'; errors: string[] }
  | { ok: false; kind: 'not_found'; message: string }
  | { ok: false; kind: 'warehouse'; message: string };

export interface CreateInput {
  name: string;
  kind: ModelKind;
  database?: string | null;
  definition: ModelDefinition;
  note?: string;
}

function toModelInput(name: string, kind: ModelKind, database: string | null | undefined, definition: ModelDefinition): ModelInput {
  return { name, kind, database: database ?? undefined, definition };
}

// CREATE (v1): validate+build → apply to ClickHouse → record v1 with the exact DDL. If the DDL
// fails on the warehouse, NOTHING is stored (fail-closed — no orphan version row).
export async function createModelLive(
  input: CreateInput,
  orgId: string,
  warehouse: WarehousePort = clickhouseWarehouse,
): Promise<ServiceResult<SchemaModelDetail>> {
  const plan = planModelApply(toModelInput(input.name, input.kind, input.database, input.definition));
  if (!plan.ok) return { ok: false, kind: 'invalid', errors: plan.errors };

  const applied = await warehouse.execDdl(plan.statements);
  if (!applied.ok) return { ok: false, kind: 'warehouse', message: applied.reason };

  const created = await createModel(
    {
      name: input.name,
      database: input.database ?? null,
      kind: input.kind,
      definition: input.definition,
      applyDdl: plan.statements,
      note: input.note ?? 'initial version',
    },
    orgId,
  );
  const detail = await getModel(created.id, orgId);
  return { ok: true, value: detail! };
}

// EDIT (→ new version): the name/kind/database are fixed at create time; an edit re-defines the
// body. Validate+build the new definition against the existing identity → apply → append the new
// version and bump current_version.
export async function editModelLive(
  id: string,
  definition: ModelDefinition,
  note: string | undefined,
  orgId: string,
  warehouse: WarehousePort = clickhouseWarehouse,
): Promise<ServiceResult<SchemaModelDetail>> {
  const existing = await getModel(id, orgId);
  if (!existing) return { ok: false, kind: 'not_found', message: `model ${id} not found` };

  const plan = planModelApply(toModelInput(existing.name, existing.kind, existing.database, definition));
  if (!plan.ok) return { ok: false, kind: 'invalid', errors: plan.errors };

  const applied = await warehouse.execDdl(plan.statements);
  if (!applied.ok) return { ok: false, kind: 'warehouse', message: applied.reason };

  const version = nextVersion(existing.currentVersion);
  const updated = await addModelVersion(id, version, definition, plan.statements, note, orgId);
  if (!updated) return { ok: false, kind: 'not_found', message: `model ${id} not found` };
  const detail = await getModel(id, orgId);
  return { ok: true, value: detail! };
}

// ROLLBACK: re-apply a prior version's FROZEN DDL live, then move the current-version pointer. The
// migration trail is preserved (we don't delete newer versions) — the pointer just points back.
export async function rollbackModelLive(
  id: string,
  targetVersion: number,
  orgId: string,
  warehouse: WarehousePort = clickhouseWarehouse,
): Promise<ServiceResult<SchemaModelDetail>> {
  const existing = await getModel(id, orgId);
  if (!existing) return { ok: false, kind: 'not_found', message: `model ${id} not found` };

  const plan = planRollback(existing.versions, targetVersion);
  if (!plan.ok) return { ok: false, kind: 'invalid', errors: [plan.reason] };

  const applied = await warehouse.execDdl(plan.statements);
  if (!applied.ok) return { ok: false, kind: 'warehouse', message: applied.reason };

  const moved = await setCurrentVersion(id, targetVersion, orgId);
  if (!moved) return { ok: false, kind: 'not_found', message: `model ${id} not found` };
  const detail = await getModel(id, orgId);
  return { ok: true, value: detail! };
}

// DELETE: drop the live object in ClickHouse, then remove the store rows (model + all versions). If
// the DROP fails on the warehouse we DON'T remove the store rows (so the operator can retry) — the
// object and its migration trail stay consistent.
export async function deleteModelLive(
  id: string,
  orgId: string,
  warehouse: WarehousePort = clickhouseWarehouse,
): Promise<ServiceResult<SchemaModel>> {
  const existing = await getModel(id, orgId);
  if (!existing) return { ok: false, kind: 'not_found', message: `model ${id} not found` };

  const applied = await warehouse.execDdl(planModelDrop(existing.kind, existing.name, existing.database));
  if (!applied.ok) return { ok: false, kind: 'warehouse', message: applied.reason };

  await deleteModel(id, orgId);
  return { ok: true, value: existing };
}
