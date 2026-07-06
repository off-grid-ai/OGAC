import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { EvalDefDraft } from '@/lib/eval-defs-policy';
import type { EvalEngine, MetricDirection } from '@/lib/eval-templates';

// EVAL-DEFINITION store — the DB ADAPTER over the pure validation in eval-defs-policy.ts. An eval
// definition is a console-owned, first-class saved evaluator (what a template becomes when applied,
// or an authored-from-scratch one). Its table is created idempotently on first use (same memoized
// ensure pattern as analytics-rules.ts / chat.ts) so the module deploys over SSH with no migration
// step — src/db/schema.ts is intentionally NOT touched.
//
// DDL (noted for SERVER_STATE):
//   CREATE TABLE IF NOT EXISTS eval_definitions (
//     id text PRIMARY KEY, name text NOT NULL, template_id text NOT NULL DEFAULT '',
//     metric text NOT NULL, engine text NOT NULL, direction text NOT NULL DEFAULT 'higher-better',
//     threshold real NOT NULL DEFAULT 0.7, suite text NOT NULL DEFAULT 'golden',
//     description text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT '',
//     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

export interface EvalDef {
  id: string;
  name: string;
  templateId: string;
  metric: string;
  engine: EvalEngine;
  direction: MetricDirection;
  threshold: number;
  suite: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

let ensurePromise: Promise<void> | null = null;
export async function ensureEvalDefsSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS eval_definitions (
        id text PRIMARY KEY,
        name text NOT NULL,
        template_id text NOT NULL DEFAULT '',
        metric text NOT NULL,
        engine text NOT NULL,
        direction text NOT NULL DEFAULT 'higher-better',
        threshold real NOT NULL DEFAULT 0.7,
        suite text NOT NULL DEFAULT 'golden',
        description text NOT NULL DEFAULT '',
        created_by text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());
    `);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

interface Row {
  id: string;
  name: string;
  template_id: string | null;
  metric: string;
  engine: string;
  direction: string | null;
  threshold: number | string;
  suite: string | null;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  [k: string]: unknown;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toDef(r: Row): EvalDef {
  return {
    id: r.id,
    name: r.name,
    templateId: r.template_id ?? '',
    metric: r.metric,
    engine: r.engine as EvalEngine,
    direction: (r.direction ?? 'higher-better') as MetricDirection,
    threshold: Number(r.threshold),
    suite: r.suite ?? 'golden',
    description: r.description ?? '',
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function listEvalDefs(): Promise<EvalDef[]> {
  await ensureEvalDefsSchema();
  const { rows } = await db.execute<Row>(
    sql`SELECT id, name, template_id, metric, engine, direction, threshold, suite, description,
               created_at, updated_at
        FROM eval_definitions ORDER BY created_at DESC;`,
  );
  return rows.map(toDef);
}

export async function getEvalDef(id: string): Promise<EvalDef | null> {
  await ensureEvalDefsSchema();
  const { rows } = await db.execute<Row>(
    sql`SELECT id, name, template_id, metric, engine, direction, threshold, suite, description,
               created_at, updated_at
        FROM eval_definitions WHERE id = ${id} LIMIT 1;`,
  );
  return rows[0] ? toDef(rows[0]) : null;
}

export async function addEvalDef(draft: EvalDefDraft, createdBy = ''): Promise<EvalDef> {
  await ensureEvalDefsSchema();
  const id = `ed_${randomUUID().slice(0, 8)}`;
  const { rows } = await db.execute<Row>(
    sql`INSERT INTO eval_definitions
          (id, name, template_id, metric, engine, direction, threshold, suite, description, created_by)
        VALUES (${id}, ${draft.name}, ${draft.templateId}, ${draft.metric}, ${draft.engine},
                ${draft.direction}, ${draft.threshold}, ${draft.suite}, ${draft.description}, ${createdBy})
        RETURNING id, name, template_id, metric, engine, direction, threshold, suite, description,
                  created_at, updated_at;`,
  );
  return toDef(rows[0]);
}

export async function updateEvalDef(id: string, draft: EvalDefDraft): Promise<EvalDef | null> {
  await ensureEvalDefsSchema();
  const { rows } = await db.execute<Row>(
    sql`UPDATE eval_definitions
        SET name = ${draft.name}, template_id = ${draft.templateId}, metric = ${draft.metric},
            engine = ${draft.engine}, direction = ${draft.direction}, threshold = ${draft.threshold},
            suite = ${draft.suite}, description = ${draft.description}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, name, template_id, metric, engine, direction, threshold, suite, description,
                  created_at, updated_at;`,
  );
  return rows[0] ? toDef(rows[0]) : null;
}

export async function deleteEvalDef(id: string): Promise<void> {
  await ensureEvalDefsSchema();
  await db.execute(sql`DELETE FROM eval_definitions WHERE id = ${id};`);
}
