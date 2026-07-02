import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/db';
import { configAudit } from '@/db/schema';
import { CONFIG_REGISTRY, type ConfigKeyDef } from '@/lib/config-registry';

// The env file the app loads at boot — edits here take effect on restart. Override
// with OFFGRID_ENV_FILE for non-default deployments.
const ENV_FILE = process.env.OFFGRID_ENV_FILE ?? path.join(process.cwd(), '.env.local');

export interface ConfigEntry extends ConfigKeyDef {
  /** Current effective value. Secrets are never returned raw — only whether set. */
  value: string;
  /** For secrets: true if a value is currently set (so the UI can show "•••• set"). */
  isSet: boolean;
  source: 'env-file' | 'process' | 'default';
}

// Parse a dotenv file into a { KEY: value } map. Minimal: KEY=VALUE per line,
// ignores comments/blanks, strips surrounding quotes.
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

async function readEnvFile(): Promise<Record<string, string>> {
  try { return parseEnv(await readFile(ENV_FILE, 'utf8')); } catch { return {}; }
}

// Full config view for the UI — registry ⋈ env-file ⋈ process.env, secrets masked.
export async function getConfigEntries(): Promise<ConfigEntry[]> {
  const fileMap = await readEnvFile();
  return CONFIG_REGISTRY.map((def) => {
    const fromFile = fileMap[def.key];
    const fromProc = process.env[def.key];
    const raw = fromFile ?? fromProc ?? '';
    const source: ConfigEntry['source'] = fromFile !== undefined ? 'env-file' : fromProc !== undefined ? 'process' : 'default';
    const isSet = raw !== '';
    return {
      ...def,
      value: def.secret ? '' : raw, // never leak secret values to the client
      isSet,
      source,
    };
  });
}

// Reveal the raw value of a single key (secrets included). Admin-gated at the route.
// The effective value = env-file override ?? process env ?? ''.
export async function revealConfig(key: string): Promise<string | null> {
  if (!CONFIG_REGISTRY.some((d) => d.key === key)) return null;
  const fileMap = await readEnvFile();
  return fileMap[key] ?? process.env[key] ?? '';
}

// Write one or more keys to the env file (upsert lines) and record an audit row each.
// Secrets are written to the file but their values are redacted in the audit log.
export async function setConfig(
  updates: Record<string, string>,
  actor: string,
): Promise<{ applied: string[]; restartRequired: string[] }> {
  const known = new Map(CONFIG_REGISTRY.map((d) => [d.key, d]));
  const entries = Object.entries(updates).filter(([k]) => known.has(k));
  if (!entries.length) return { applied: [], restartRequired: [] };

  const fileMap = await readEnvFile();
  const before: Record<string, string> = { ...fileMap };

  // Rewrite the file preserving unknown lines; upsert our keys.
  let text = '';
  try { text = await readFile(ENV_FILE, 'utf8'); } catch { text = ''; }
  for (const [key, value] of entries) {
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
    const line = `${key}=${value}`;
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  await writeFile(ENV_FILE, text, 'utf8');

  // Audit — redact secret values.
  const now = new Date();
  await Promise.all(
    entries.map(([key, value], i) => {
      const def = known.get(key)!;
      const redact = (v: string | undefined) => (v === undefined ? null : def.secret ? (v ? '••••' : '') : v);
      return db.insert(configAudit).values({
        id: `cfg_${now.getTime()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        key,
        actor,
        oldValue: redact(before[key]),
        newValue: redact(value),
        at: now,
      });
    }),
  );

  const restartRequired = entries.filter(([k]) => known.get(k)!.restartRequired).map(([k]) => k);
  return { applied: entries.map(([k]) => k), restartRequired };
}
