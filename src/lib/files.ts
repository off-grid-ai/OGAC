import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

// File storage service — upload bytes, retrieve them, toggle public/private. Files live
// on the local disk (data stays on-prem); metadata in Postgres. Schema is created
// idempotently on first use (same pattern as the prompt library) so it deploys over
// SSH with no migration step.

const FILES_DIR = process.env.OFFGRID_FILES_DIR || path.join(process.cwd(), 'deploy', 'files-store');

let ensurePromise: Promise<void> | null = null;
export async function ensureFileSchema(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async (): Promise<void> => {
    await mkdir(FILES_DIR, { recursive: true });
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS files (
        id text PRIMARY KEY,
        name text NOT NULL DEFAULT 'file',
        mime text NOT NULL DEFAULT 'application/octet-stream',
        size integer NOT NULL DEFAULT 0,
        visibility text NOT NULL DEFAULT 'private',
        owner text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner, created_at);`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  visibility: 'public' | 'private';
  owner: string;
  createdAt: string;
}

function rowToMeta(r: Record<string, unknown>): FileMeta {
  return {
    id: String(r.id),
    name: String(r.name),
    mime: String(r.mime),
    size: Number(r.size),
    visibility: r.visibility === 'public' ? 'public' : 'private',
    owner: String(r.owner),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export async function saveFile(o: {
  name: string;
  mime: string;
  bytes: Buffer;
  visibility: string;
  owner: string;
}): Promise<FileMeta> {
  await ensureFileSchema();
  const id = crypto.randomUUID();
  const visibility = o.visibility === 'public' ? 'public' : 'private';
  await writeFile(path.join(FILES_DIR, id), o.bytes);
  await db.execute(
    sql`INSERT INTO files (id, name, mime, size, visibility, owner)
        VALUES (${id}, ${o.name}, ${o.mime}, ${o.bytes.length}, ${visibility}, ${o.owner})`,
  );
  return { id, name: o.name, mime: o.mime, size: o.bytes.length, visibility, owner: o.owner, createdAt: new Date().toISOString() };
}

export async function getFileMeta(id: string): Promise<FileMeta | null> {
  await ensureFileSchema();
  const res = await db.execute(sql`SELECT * FROM files WHERE id = ${id}`);
  const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0];
  return row ? rowToMeta(row) : null;
}

export async function readFileBytes(id: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(FILES_DIR, id));
  } catch {
    return null;
  }
}

export async function listFiles(owner: string): Promise<FileMeta[]> {
  await ensureFileSchema();
  const res = await db.execute(sql`SELECT * FROM files WHERE owner = ${owner} ORDER BY created_at DESC LIMIT 500`);
  return ((res as { rows?: Record<string, unknown>[] }).rows ?? []).map(rowToMeta);
}

// Owner (or admin) can change visibility. Returns the updated meta or null if not found/allowed.
export async function setVisibility(id: string, visibility: string, owner: string, isAdmin: boolean): Promise<FileMeta | null> {
  const meta = await getFileMeta(id);
  if (!meta || (!isAdmin && meta.owner !== owner)) return null;
  const v = visibility === 'public' ? 'public' : 'private';
  await db.execute(sql`UPDATE files SET visibility = ${v} WHERE id = ${id}`);
  return { ...meta, visibility: v };
}

export async function deleteFile(id: string, owner: string, isAdmin: boolean): Promise<boolean> {
  const meta = await getFileMeta(id);
  if (!meta || (!isAdmin && meta.owner !== owner)) return false;
  await db.execute(sql`DELETE FROM files WHERE id = ${id}`);
  await unlink(path.join(FILES_DIR, id)).catch(() => {});
  return true;
}
