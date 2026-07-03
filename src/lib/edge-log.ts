import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Edge intelligence for the console — reads what the Caddy edge is actually doing:
// the live WAF + rate-limit POLICY (parsed from the Caddyfile) and recent BLOCKS
// (403 WAF / 429 rate-limit) from Caddy's JSON access log. The console runs on the
// same host as Caddy, so both are local file reads — no extra service.

const LOG_PATH = process.env.OFFGRID_EDGE_LOG || path.join(process.cwd(), 'deploy', 'edge-access.log');
const CADDYFILE = process.env.OFFGRID_CADDYFILE || path.join(process.cwd(), 'deploy', 'Caddyfile');

export interface EdgeEvent {
  ts: string;
  status: number;
  kind: 'waf' | 'rate-limit';
  ip: string;
  host: string;
  method: string;
  uri: string;
}

export interface EdgePolicy {
  rateLimit: { events: number; window: string; zone: string } | null;
  wafEnabled: boolean;
  wafRules: string[];
  hosts: string[];
}

export interface TrafficRow {
  ts: string;
  status: number;
  ip: string;
  host: string;
  method: string;
  uri: string;
}

export interface EdgeSnapshot {
  configured: boolean;
  policy: EdgePolicy;
  summary: { total: number; waf: number; rateLimited: number; uniqueIps: number };
  recent: EdgeEvent[];
  // All recent requests (allowed + blocked) so the page has data even when nothing is blocked.
  traffic: { total: number; allowed: number; blocked: number; recent: TrafficRow[] };
}

interface RawLine {
  ts?: number;
  status?: number;
  request?: { remote_ip?: string; host?: string; method?: string; uri?: string; headers?: Record<string, string[]> };
}

function realIp(r: RawLine['request']): string {
  const cf = r?.headers?.['Cf-Connecting-Ip']?.[0];
  return cf || r?.remote_ip || 'unknown';
}

async function parsePolicy(): Promise<EdgePolicy> {
  let text = '';
  try { text = await readFile(CADDYFILE, 'utf8'); } catch { /* no file */ }
  // The limit is passed to the (edge) snippet at the call site: `import edge <zone> <events>`.
  const imp = text.match(/import\s+edge\s+(\S+)\s+(\d+)/);
  const window = text.match(/window\s+(\S+)/);
  const wafRules = [...text.matchAll(/msg:'([^']+)'/g)].map((m) => m[1]);
  const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+\.getoffgridai\.co)/g)].map((m) => m[1]);
  return {
    rateLimit: imp ? { events: Number(imp[2]), window: window?.[1] ?? '1m', zone: imp[1] } : null,
    wafEnabled: /SecRuleEngine\s+On/i.test(text),
    wafRules,
    hosts: [...new Set(hosts)],
  };
}

// eslint-disable-next-line complexity
async function parseLog(limit = 200): Promise<EdgeEvent[]> {
  let text = '';
  try { text = await readFile(LOG_PATH, 'utf8'); } catch { return []; }
  const lines = text.split('\n').filter(Boolean);
  const events: EdgeEvent[] = [];
  // Walk from the end — most recent first — until we have `limit` blocked events.
  for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
    let o: RawLine;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o.status !== 403 && o.status !== 429) continue;
    events.push({
      ts: o.ts ? new Date(o.ts * 1000).toISOString() : '',
      status: o.status,
      kind: o.status === 403 ? 'waf' : 'rate-limit',
      ip: realIp(o.request),
      host: o.request?.host ?? '',
      method: o.request?.method ?? '',
      uri: o.request?.uri ?? '',
    });
  }
  return events;
}

// All recent requests (any status), newest first — for the traffic view.
async function parseTraffic(limit = 100): Promise<{ total: number; allowed: number; blocked: number; recent: TrafficRow[] }> {
  let text = '';
  try { text = await readFile(LOG_PATH, 'utf8'); } catch { return { total: 0, allowed: 0, blocked: 0, recent: [] }; }
  const lines = text.split('\n').filter(Boolean);
  let total = 0, blocked = 0;
  const recent: TrafficRow[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: RawLine;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    if (typeof o.status !== 'number') continue;
    total++;
    if (o.status === 403 || o.status === 429) blocked++;
    if (recent.length < limit) {
      recent.push({
        ts: o.ts ? new Date(o.ts * 1000).toISOString() : '',
        status: o.status,
        ip: realIp(o.request),
        host: o.request?.host ?? '',
        method: o.request?.method ?? '',
        uri: o.request?.uri ?? '',
      });
    }
  }
  return { total, allowed: total - blocked, blocked, recent };
}

export async function getEdgeSnapshot(): Promise<EdgeSnapshot> {
  const [policy, recent, traffic] = await Promise.all([parsePolicy(), parseLog(), parseTraffic()]);
  const waf = recent.filter((e) => e.kind === 'waf').length;
  const rateLimited = recent.filter((e) => e.kind === 'rate-limit').length;
  const uniqueIps = new Set(recent.map((e) => e.ip)).size;
  return {
    configured: policy.wafEnabled || policy.rateLimit !== null,
    policy,
    summary: { total: recent.length, waf, rateLimited, uniqueIps },
    recent,
    traffic,
  };
}
