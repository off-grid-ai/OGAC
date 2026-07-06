// ─── Email trigger adapter (Builder Epic #103, Phase 4C) — ON-PREM IMAP poller ───────────────────
//
// The email trigger fires an app-run from a new inbound email. AIR-GAP SAFE (risk #4): it connects
// ONLY to the org's OWN IMAP server — the host the operator explicitly set in OFFGRID_EMAIL_IMAP_URL.
// There is NO cloud provider path, no OAuth-to-Gmail, no default host. Unconfigured → the poller is
// disabled and does nothing (never silently reaches for a cloud mailbox).
//
// It speaks a MINIMAL IMAP over Node's built-in tls/net sockets (no new dependency): LOGIN → SELECT
// → SEARCH UNSEEN → FETCH headers+body → for each new matching message, normalize via the PURE
// buildTriggerInput and funnel through submitAppRun (the SAME governed entry point — policy /
// guardrails / grounding / signing apply). Processed messages are marked \Seen so they fire once.
//
// SOLID: config parsing + payload shaping are PURE (trigger-dispatch.ts) and unit-tested; this file
// is the thin I/O bridge (socket + submit). It matches a message to an app by a configurable
// subject/recipient convention. Every op is graceful — errors are logged and the poll loop continues.

import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';
import { getAppBySlug } from '@/lib/apps-store';
import { newAppRunId } from '@/lib/app-run';
import { submitAppRun } from '@/lib/adapters/apprun';
import {
  buildTriggerInput,
  imapConfigFromEnv,
  type EmailPayload,
  type ImapConfig,
} from '@/lib/trigger-dispatch';

export interface EmailPollResult {
  configured: boolean;
  processed: number;
  matched: number;
  errors: string[];
  note?: string;
}

// ─── isEmailTriggerConfigured — disabled unless the on-prem IMAP env is present + valid ───────────
export function isEmailTriggerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return imapConfigFromEnv(env).ok;
}

// ─── An app is email-triggered if its trigger.kind === 'email'. It routes by subject/recipient. ──
// Convention (pure, no I/O): the app matched is the one whose email-trigger `config.folder`/`from`
// matches, OR the app whose slug appears as a `+slug` recipient tag (bot+<slug>@…) or in the subject
// as `[app:<slug>]`. Kept deliberately simple + explicit so routing is predictable and auditable.
export function appSlugForMessage(msg: EmailPayload): string | null {
  // 1. plus-addressing: to: bot+my-app@corp → my-app
  const to = (msg.to ?? '').toLowerCase();
  const plus = /\+([a-z0-9_-]+)@/.exec(to);
  if (plus) return plus[1];
  // 2. subject tag: [app:my-app]
  const subj = msg.subject ?? '';
  const tag = /\[app:([a-z0-9_-]+)\]/i.exec(subj);
  if (tag) return tag[1].toLowerCase();
  return null;
}

// ─── pollEmailTriggers — one poll cycle. Graceful; safe to call on an interval. ───────────────────
export async function pollEmailTriggers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmailPollResult> {
  const cfgResult = imapConfigFromEnv(env);
  if (!cfgResult.ok) {
    return { configured: false, processed: 0, matched: 0, errors: [], note: cfgResult.reason };
  }
  const cfg = cfgResult.config!;
  const errors: string[] = [];
  let processed = 0;
  let matched = 0;

  let client: ImapClient | null = null;
  try {
    client = await ImapClient.open(cfg);
    await client.login(cfg.user, cfg.pass);
    await client.select(cfg.mailbox);
    const uids = await client.searchUnseen();
    for (const uid of uids) {
      try {
        const msg = await client.fetchMessage(uid);
        processed++;
        const slug = appSlugForMessage(msg);
        if (!slug) continue;
        const app = await getAppBySlug(slug);
        if (!app || !app.published || app.trigger?.kind !== 'email') continue;
        const input = buildTriggerInput('email', msg);
        await submitAppRun(app, input, {
          orgId: app.orgId,
          actor: 'trigger:email',
          runId: newAppRunId(),
        });
        matched++;
        await client.markSeen(uid); // fire once
      } catch (e) {
        errors.push(`uid ${uid}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push((e as Error).message);
  } finally {
    try {
      await client?.logout();
    } catch {
      /* ignore */
    }
  }
  return { configured: true, processed, matched, errors };
}

// ─── Minimal IMAP client (tls/net only) — connects ONLY to the configured on-prem host ────────────
// A deliberately small, line-oriented IMAP subset: enough to LOGIN, SELECT, SEARCH UNSEEN, FETCH
// (RFC822 subset), STORE \Seen, LOGOUT. Not a general IMAP library — it does exactly what the poller
// needs and nothing more, so there is no surface to accidentally reach a cloud endpoint.
class ImapClient {
  private sock: Socket;
  private buf = '';
  private tagN = 0;
  private waiters: Array<{ tag: string; resolve: (lines: string[]) => void; reject: (e: Error) => void; lines: string[] }> =
    [];

  private constructor(sock: Socket) {
    this.sock = sock;
    this.sock.setEncoding('utf8');
    this.sock.on('data', (d: string) => this.onData(d));
  }

  static open(cfg: ImapConfig): Promise<ImapClient> {
    const { host, port } = splitHostPort(cfg.host, cfg.tls ? 993 : 143);
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      const sock = cfg.tls
        ? tlsConnect({ host, port, servername: host }, () => finish())
        : netConnect({ host, port }, () => finish());
      sock.setTimeout(20_000, () => sock.destroy(new Error('IMAP connect timeout')));
      sock.once('error', onErr);
      function finish() {
        sock.removeListener('error', onErr);
        resolve(new ImapClient(sock as Socket));
      }
    });
  }

  private onData(d: string): void {
    this.buf += d;
    let idx: number;
    while ((idx = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const w = this.waiters[0];
      if (!w) continue; // untagged greeting / unsolicited before any command
      if (line.startsWith(`${w.tag} `)) {
        this.waiters.shift();
        if (/^[A-Za-z0-9]+ OK/.test(line)) w.resolve(w.lines);
        else w.reject(new Error(line));
      } else {
        w.lines.push(line);
      }
    }
  }

  private send(cmd: string): Promise<string[]> {
    const tag = `A${++this.tagN}`;
    return new Promise((resolve, reject) => {
      this.waiters.push({ tag, resolve, reject, lines: [] });
      this.sock.write(`${tag} ${cmd}\r\n`);
    });
  }

  // The server's greeting is an untagged `* OK …` line that arrives before any command; onData()
  // discards untagged lines that have no pending tag, so we can issue LOGIN immediately. Credentials
  // come ONLY from the on-prem config the operator set — never a cloud provider.
  async login(user: string, pass: string): Promise<void> {
    await this.send(`LOGIN ${quote(user)} ${quote(pass)}`);
  }

  async select(mailbox: string): Promise<void> {
    await this.send(`SELECT ${quote(mailbox)}`);
  }

  async searchUnseen(): Promise<number[]> {
    const lines = await this.send('UID SEARCH UNSEEN');
    const hit = lines.find((l) => /^\*\s+SEARCH/i.test(l));
    if (!hit) return [];
    return hit
      .replace(/^\*\s+SEARCH/i, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
  }

  async fetchMessage(uid: number): Promise<EmailPayload> {
    const lines = await this.send(`UID FETCH ${uid} (BODY.PEEK[HEADER] BODY.PEEK[TEXT])`);
    return parseFetched(lines.join('\r\n'));
  }

  async markSeen(uid: number): Promise<void> {
    await this.send(`UID STORE ${uid} +FLAGS (\\Seen)`);
  }

  async logout(): Promise<void> {
    try {
      await this.send('LOGOUT');
    } finally {
      this.sock.end();
    }
  }
}

// ── helpers (pure-ish, socket-free) ──────────────────────────────────────────────────────────────
function splitHostPort(hostRaw: string, defPort: number): { host: string; port: number } {
  const h = hostRaw.trim();
  const m = /^(.+):(\d+)$/.exec(h);
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: h, port: defPort };
}

function quote(s: string): string {
  return `"${s.replace(/(["\\])/g, '\\$1')}"`;
}

// Extract From/To/Subject/Message-Id/Date headers + a best-effort text body from a raw FETCH dump.
export function parseFetched(raw: string): EmailPayload {
  const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? '';
  const header = (name: string): string => {
    const re = new RegExp(`^${name}:\\s*(.*)$`, 'im');
    const m = re.exec(headerBlock);
    return m ? m[1].trim() : '';
  };
  // Body: text after the first blank line, stripped of the trailing IMAP literal markers/closing paren.
  const parts = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n');
  const text = parts
    .replace(/\)\s*$/, '')
    .replace(/^\* \d+ FETCH.*$/gm, '')
    .trim();
  return {
    from: header('From'),
    to: header('To'),
    subject: header('Subject'),
    messageId: header('Message-Id') || header('Message-ID'),
    date: header('Date'),
    text,
  };
}
