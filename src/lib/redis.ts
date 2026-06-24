import { createConnection, type Socket } from 'net';

// Minimal RESP (Redis serialization protocol) client — just the GET / SET / PING we need for the
// caching port, with zero external dependency. A single lazily-opened connection with a FIFO queue
// of pending replies; on any socket error it tears down and the next call reconnects. Best-effort:
// the caching port falls back to in-process memory if Redis is unreachable, so this never throws
// to the request path.
interface Pending {
  resolve: (v: string | null) => void;
  reject: (e: Error) => void;
}

class RedisClient {
  private sock: Socket | null = null;
  private buf = Buffer.alloc(0);
  private queue: Pending[] = [];
  private readonly host: string;
  private readonly port: number;

  constructor(url: string) {
    const u = new URL(url);
    this.host = u.hostname;
    this.port = Number(u.port || 6379);
  }

  private connect(): Promise<Socket> {
    if (this.sock && !this.sock.destroyed) return Promise.resolve(this.sock);
    return new Promise((resolve, reject) => {
      const s = createConnection({ host: this.host, port: this.port });
      s.setTimeout(3000);
      s.once('connect', () => {
        this.sock = s;
        resolve(s);
      });
      s.on('data', (d) => this.onData(d));
      const fail = (e: Error) => {
        this.teardown(e);
        reject(e);
      };
      s.once('error', fail);
      s.once('timeout', () => fail(new Error('redis timeout')));
      s.once('close', () => this.teardown(new Error('redis closed')));
    });
  }

  private teardown(err: Error): void {
    this.sock?.destroy();
    this.sock = null;
    this.buf = Buffer.alloc(0);
    const q = this.queue;
    this.queue = [];
    for (const p of q) p.reject(err);
  }

  // Parse as many complete replies as are buffered, resolving queued callers in order.
  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let reply = this.takeReply();
    while (reply !== undefined) {
      this.queue.shift()?.resolve(reply);
      reply = this.takeReply();
    }
  }

  // Bulk string ($<len>\r\n<data>\r\n) — returns undefined if the full payload isn't buffered yet.
  private takeBulk(nl: number, len: number): string | null | undefined {
    if (len === -1) {
      this.buf = this.buf.subarray(nl + 2);
      return null;
    }
    const end = nl + 2 + len + 2;
    if (this.buf.length < end) return undefined;
    const data = this.buf.subarray(nl + 2, nl + 2 + len).toString();
    this.buf = this.buf.subarray(end);
    return data;
  }

  // Extract one complete reply from the buffer (the subset of RESP we use), or undefined if the
  // buffer doesn't yet hold a full reply.
  private takeReply(): string | null | undefined {
    const nl = this.buf.indexOf('\r\n');
    if (nl === -1) return undefined;
    const type = String.fromCharCode(this.buf[0]);
    const line = this.buf.subarray(1, nl).toString();
    if (type === '$') return this.takeBulk(nl, Number(line));
    // Simple string (+), integer (:), error (-), or anything else — single line.
    this.buf = this.buf.subarray(nl + 2);
    return type === '+' || type === ':' ? line : null;
  }

  private async command(args: string[]): Promise<string | null> {
    const sock = await this.connect();
    const payload =
      `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('');
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      sock.write(payload, (err) => {
        if (err) reject(err);
      });
    });
  }

  get(key: string): Promise<string | null> {
    return this.command(['GET', key]);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<string | null> {
    return this.command(['SET', key, value, 'EX', String(Math.max(1, Math.floor(ttlSeconds)))]);
  }

  ping(): Promise<string | null> {
    return this.command(['PING']);
  }
}

let client: RedisClient | null = null;

export function redis(url: string): RedisClient {
  if (!client) client = new RedisClient(url);
  return client;
}
