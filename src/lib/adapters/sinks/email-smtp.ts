// ─── Email output sink (Builder Epic Phase 4B, §3.3) — ON-PREM SMTP send ──────────────────────────
//
// The `output:email` sink delivers an app-run's result by SMTP. AIR-GAP SAFE — it mirrors the
// email-imap trigger adapter's guarantee exactly: it connects ONLY to the SMTP host the operator set
// in OFFGRID_SMTP_URL. There is NO cloud provider path, no default host, no OAuth-to-a-SaaS. When the
// on-prem env is absent → the sink is DISABLED and reports "not configured" HONESTLY — it never
// silently claims a send it didn't make, and never reaches for a cloud mailbox.
//
// It speaks a MINIMAL SMTP over Node's built-in tls/net sockets (no new dependency): EHLO → optional
// AUTH LOGIN → MAIL FROM → RCPT TO → DATA → a plain-text (optionally attachment-bearing) MIME body →
// QUIT. Not a general SMTP library — exactly what the sink needs and nothing more, so there is no
// surface to accidentally reach a cloud endpoint.
//
// SOLID: config parsing (smtpConfigFromEnv) is PURE + unit-tested; MIME building (buildMimeMessage) is
// PURE + unit-tested; this file's only I/O is the socket conversation in SmtpClient. Every op is
// graceful — it returns a typed SendEmailResult, never throws into the executor.

import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

// ─── config ───────────────────────────────────────────────────────────────────────────────────────
export interface SmtpConfig {
  host: string;
  port: number;
  tls: boolean; // implicit TLS (smtps:// / :465) — we connect over TLS from the first byte
  user?: string;
  pass?: string;
  from: string; // envelope + header From
}

export interface SmtpConfigResult {
  ok: boolean;
  config?: SmtpConfig;
  reason: string;
}

/**
 * Parse the on-prem SMTP sink config from env. PURE. Requires OFFGRID_SMTP_URL (+ a From address).
 * The URL must be an explicit host the operator set — we do not invent one. Accepts a bare host[:port]
 * or an smtp(s):// URL; rejects http(s)/other schemes so it can't point at a random web endpoint.
 * Missing URL / From → disabled (the sink then reports "not configured", never a fake success).
 */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfigResult {
  const raw = (env.OFFGRID_SMTP_URL ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      reason: 'Email sink not configured — set OFFGRID_SMTP_URL to your on-prem SMTP server to enable.',
    };
  }
  const from = (env.OFFGRID_SMTP_FROM ?? '').trim();
  if (!from) {
    return {
      ok: false,
      reason: 'Email sink not configured — OFFGRID_SMTP_FROM (the sender address) is required.',
    };
  }
  const parsed = parseSmtpUrl(raw);
  if (!parsed) {
    return {
      ok: false,
      reason: 'Email sink not configured — OFFGRID_SMTP_URL is not a valid host or smtp(s):// URL.',
    };
  }
  const user = (env.OFFGRID_SMTP_USER ?? '').trim() || undefined;
  const pass = env.OFFGRID_SMTP_PASS || undefined;
  return {
    ok: true,
    config: { host: parsed.host, port: parsed.port, tls: parsed.tls, user, pass, from },
    reason: 'ok',
  };
}

// Accept a bare host[:port] or an smtp://host / smtps://host URL. smtps:// (or :465) → implicit TLS.
function parseSmtpUrl(raw: string): { host: string; port: number; tls: boolean } | null {
  const val = raw.trim();
  if (!val) return null;
  if (val.includes('://')) {
    const scheme = val.slice(0, val.indexOf('://')).toLowerCase();
    if (scheme !== 'smtp' && scheme !== 'smtps') return null;
    const rest = val.slice(val.indexOf('://') + 3).replace(/\/+$/, '');
    if (!rest || /\s/.test(rest)) return null;
    const tls = scheme === 'smtps';
    const { host, port } = splitHostPort(rest, tls ? 465 : 587);
    return { host, port, tls: tls || port === 465 };
  }
  if (/\s/.test(val) || val.includes('/')) return null;
  const { host, port } = splitHostPort(val, 587);
  return { host, port, tls: port === 465 };
}

function splitHostPort(hostRaw: string, defPort: number): { host: string; port: number } {
  const h = hostRaw.trim();
  const m = /^(.+):(\d+)$/.exec(h);
  if (m) return { host: m[1], port: Number(m[2]) };
  return { host: h, port: defPort };
}

// ─── isEmailSinkConfigured — disabled unless the on-prem SMTP env is present + valid ──────────────
export function isEmailSinkConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return smtpConfigFromEnv(env).ok;
}

// ─── MIME (PURE) ────────────────────────────────────────────────────────────────────────────────
export interface EmailAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

/**
 * Build an RFC-5322/MIME message (PURE). A plain-text body when there are no attachments; a
 * multipart/mixed body when there are (text part + base64-encoded attachment parts). Header lines use
 * CRLF; the DATA terminator (a lone `.`) is added by the client, not here. Deterministic given a fixed
 * `date` + `boundary` (both injectable) so it is unit-testable byte-for-byte.
 */
export function buildMimeMessage(
  from: string,
  msg: EmailMessage,
  opts: { date?: string; boundary?: string } = {},
): string {
  const date = opts.date ?? new Date().toUTCString();
  const headers: string[] = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(msg.to)}`,
    `Subject: ${sanitizeHeader(msg.subject)}`,
    `Date: ${date}`,
    'MIME-Version: 1.0',
  ];
  const atts = msg.attachments ?? [];
  if (atts.length === 0) {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('Content-Transfer-Encoding: 8bit');
    return `${headers.join('\r\n')}\r\n\r\n${dotStuff(msg.text)}`;
  }
  const boundary = opts.boundary ?? `=_offgrid_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [];
  parts.push(
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(
      msg.text,
    )}`,
  );
  for (const a of atts) {
    const b64 = wrap76(Buffer.from(a.bytes).toString('base64'));
    parts.push(
      `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${b64}`,
    );
  }
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
}

// Strip CR/LF from a header value (guard against header injection via a run outcome).
function sanitizeHeader(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

// SMTP dot-stuffing: a line that begins with '.' gets an extra '.' so it isn't read as end-of-DATA.
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function wrap76(s: string): string {
  return (s.match(/.{1,76}/g) ?? []).join('\r\n');
}

// ─── SendEmailResult ──────────────────────────────────────────────────────────────────────────────
export interface SendEmailResult {
  ok: boolean;
  configured: boolean;
  reason: string;
}

// ─── sendEmail — the sink entry point (I/O). Never throws; returns a typed result. ────────────────
export async function sendEmail(
  msg: EmailMessage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendEmailResult> {
  const cfgResult = smtpConfigFromEnv(env);
  if (!cfgResult.ok) return { ok: false, configured: false, reason: cfgResult.reason };
  if (!msg.to || !msg.to.trim()) {
    return {
      ok: false,
      configured: true,
      reason: 'no recipient — email sink needs a `to` address (set the output step config.to)',
    };
  }
  const cfg = cfgResult.config!;
  const mime = buildMimeMessage(cfg.from, msg);
  let client: SmtpClient | null = null;
  try {
    client = await SmtpClient.open(cfg);
    await client.hello();
    if (cfg.user && cfg.pass) await client.authLogin(cfg.user, cfg.pass);
    await client.send(cfg.from, msg.to, mime);
    return { ok: true, configured: true, reason: `sent to ${msg.to} via ${cfg.host}:${cfg.port}` };
  } catch (e) {
    return { ok: false, configured: true, reason: `SMTP send failed: ${(e as Error).message}` };
  } finally {
    try {
      await client?.quit();
    } catch {
      /* ignore */
    }
  }
}

// ─── Minimal SMTP client (tls/net only) — connects ONLY to the configured on-prem host ────────────
class SmtpClient {
  private sock: Socket;
  private buf = '';
  private waiters: Array<{ resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void }> = [];

  private constructor(sock: Socket) {
    this.sock = sock;
    this.sock.setEncoding('utf8');
    this.sock.on('data', (d: string) => this.onData(d));
  }

  static open(cfg: SmtpConfig): Promise<SmtpClient> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      let client: SmtpClient;
      const sock = cfg.tls
        ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => finish())
        : netConnect({ host: cfg.host, port: cfg.port }, () => finish());
      sock.setTimeout(20_000, () => sock.destroy(new Error('SMTP connect timeout')));
      sock.once('error', onErr);
      client = new SmtpClient(sock as Socket);
      function finish() {
        sock.removeListener('error', onErr);
        // The server sends a 220 greeting; wait for it before resolving so hello() reads a clean reply.
        client.expect().then(() => resolve(client)).catch(reject);
      }
    });
  }

  // SMTP replies are line(s) ending CRLF; a multiline reply uses "250-" for continuation, "250 " for
  // the last line. We buffer until a line whose 4th char is a space (the final line), then resolve.
  private onData(d: string): void {
    this.buf += d;
    let idx: number;
    while ((idx = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      // continuation line (4th char '-') — keep reading
      if (line.length >= 4 && line[3] === '-') continue;
      const w = this.waiters.shift();
      if (!w) continue;
      const code = Number(line.slice(0, 3));
      if (Number.isFinite(code) && code >= 200 && code < 400) w.resolve({ code, text: line });
      else w.reject(new Error(line));
    }
  }

  private expect(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private cmd(line: string): Promise<{ code: number; text: string }> {
    const p = this.expect();
    this.sock.write(`${line}\r\n`);
    return p;
  }

  async hello(): Promise<void> {
    await this.cmd(`EHLO offgrid-console`);
  }

  async authLogin(user: string, pass: string): Promise<void> {
    // AUTH LOGIN: server prompts (334) for base64 username, then password.
    const p1 = this.expect();
    this.sock.write('AUTH LOGIN\r\n');
    await p1;
    const p2 = this.expect();
    this.sock.write(`${Buffer.from(user).toString('base64')}\r\n`);
    await p2;
    await this.cmd(Buffer.from(pass).toString('base64'));
  }

  async send(from: string, to: string, mime: string): Promise<void> {
    await this.cmd(`MAIL FROM:<${stripAngle(from)}>`);
    await this.cmd(`RCPT TO:<${stripAngle(to)}>`);
    // DATA → server 354 → body → lone '.'
    const p = this.expect();
    this.sock.write('DATA\r\n');
    await p;
    await this.cmd(`${mime}\r\n.`);
  }

  async quit(): Promise<void> {
    try {
      const p = this.expect();
      this.sock.write('QUIT\r\n');
      await p;
    } finally {
      this.sock.end();
    }
  }
}

// Extract the bare address from a "Name <addr>" or bare "addr" string for the SMTP envelope.
function stripAngle(addr: string): string {
  const m = /<([^>]+)>/.exec(addr);
  return (m ? m[1] : addr).trim();
}
