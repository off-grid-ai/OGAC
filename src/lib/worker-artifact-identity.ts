// ─── PURE worker artifact identity (app-worker:artifact-identity) ────────────────────────────────
//
// Zero-import, zero-I/O composition of a durable worker's immutable artifact stamp: the release
// source SHA, the Temporal Worker SDK version, the worker script, and the task queue — plus the
// Temporal `identity` string that BINDS a live poller to that artifact. When the worker registers
// with `identity = <pid>@<host>#<sha8>`, DescribeTaskQueue (see task-queue-readiness) reports pollers
// carrying the exact deployed SHA, so "which artifact is draining this queue?" is answerable from
// live poller evidence rather than inferred. The I/O half (resolving the SHA from the deploy stamp /
// env, reading the SDK version) lives in the worker entrypoints + adapter; this module is pure.

const UNKNOWN = 'unknown';

/** First 8 chars of a git SHA, or 'unknown' for an absent/placeholder value. */
export function shortSha(sha: string | undefined | null): string {
  const s = (sha ?? '').trim();
  return s && s !== UNKNOWN ? s.slice(0, 8) : UNKNOWN;
}

/**
 * The Temporal worker identity that binds a poller to its artifact: `<pid>@<host>#<sha8>`. The
 * `<pid>@<host>` prefix matches Temporal's own default identity, so existing tooling still reads it;
 * the `#<sha8>` suffix is the artifact binding. A blank host falls back to 'host'.
 */
export function workerIdentity(pid: number, host: string, sourceSha: string | undefined | null): string {
  const h = (host ?? '').trim() || 'host';
  return `${pid}@${h}#${shortSha(sourceSha)}`;
}

export interface ParsedWorkerIdentity {
  pid: string;
  host: string;
  /** The artifact SHA suffix, or null when the identity carries no `#sha` binding. */
  sha: string | null;
}

/** Parse a `<pid>@<host>#<sha>` identity. Tolerant: a plain `<pid>@<host>` yields sha=null. */
export function parseWorkerIdentity(identity: string | undefined | null): ParsedWorkerIdentity | null {
  const s = (identity ?? '').trim();
  const m = /^([^@]+)@([^#]+)(?:#(.+))?$/.exec(s);
  if (!m) return null;
  return { pid: m[1], host: m[2], sha: m[3] ? m[3] : null };
}

export interface WorkerArtifactStamp {
  service: string;
  taskQueue: string;
  sourceSha: string;
  shortSha: string;
  sdkVersion: string;
  workerScript: string;
  identity: string;
}

/** Compose the full artifact stamp for a worker from resolved inputs. PURE. */
export function workerArtifactStamp(input: {
  service: string;
  taskQueue: string;
  pid: number;
  host: string;
  sourceSha: string | undefined | null;
  sdkVersion: string | undefined | null;
  workerScript: string;
}): WorkerArtifactStamp {
  return {
    service: input.service,
    taskQueue: input.taskQueue,
    sourceSha: (input.sourceSha ?? '').trim() || UNKNOWN,
    shortSha: shortSha(input.sourceSha),
    sdkVersion: (input.sdkVersion ?? '').trim() || UNKNOWN,
    workerScript: input.workerScript,
    identity: workerIdentity(input.pid, input.host, input.sourceSha),
  };
}
