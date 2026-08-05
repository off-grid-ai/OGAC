// ─── Where a governed run is allowed to WRITE in the object store — PURE, zero-IO ────────────────
//
// The read half of governed object access already refuses to let a caller name a bucket: the data
// domain owns the bucket and prefix, the connector owns the credential, and the tenant owns both. A
// write path that took a bucket from step config would hand back exactly the authority the read path
// spent all that structure withholding — an app could be edited to write anywhere the connector's
// keypair reaches, including over its own source data.
//
// So a write names a DATA DOMAIN and a relative file name, and nothing else. The destination is
// derived. This module owns that derivation and the naming rule; the adapter does the I/O.

/** What an output step may say about where to write. Note the absence of a bucket. */
export interface ObjectSinkConfig {
  /** The approved data domain to write inside. Required — it IS the destination. */
  domain?: string;
  /**
   * Optional file name within the domain's prefix. Supports the same run tokens the report sink uses
   * so a run does not overwrite the previous one by default.
   */
  filename?: string;
  /** Content type to store. Defaults to text/plain; a `.json` name implies application/json. */
  contentType?: string;
}

export type ObjectSinkProblem = 'domain-missing' | 'filename-invalid';

export type ObjectSinkPlan =
  | { ok: true; filename: string; contentType: string }
  | { ok: false; problem: ObjectSinkProblem; sentence: string };

/**
 * A file name must be a single segment. No slashes, so a name cannot walk into a sibling folder the
 * domain does not approve; the prefix join is not the place to discover that.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_NAME = 200;

/** Default name: the run id, so two runs of one app never silently overwrite each other. */
export function defaultObjectName(runId: string): string {
  return `${runId}.txt`;
}

export function planObjectSink(cfg: ObjectSinkConfig, runId: string): ObjectSinkPlan {
  const domain = (cfg.domain ?? '').trim();
  if (!domain) {
    return {
      ok: false,
      problem: 'domain-missing',
      sentence:
        'This step has no approved data location to write to, so nothing is saved. Choose one of the data locations this workflow is allowed to use.',
    };
  }

  const raw = (cfg.filename ?? '').trim();
  // Run tokens, so a name can be stable-per-case or unique-per-run as the author intends.
  const filename = raw
    ? raw.replace(/\{runId\}/g, runId).replace(/\{run\}/g, runId).trim()
    : defaultObjectName(runId);

  if (!SEGMENT.test(filename) || filename.length > MAX_NAME || filename === '.' || filename === '..') {
    return {
      ok: false,
      problem: 'filename-invalid',
      sentence:
        'The file name can only contain letters, numbers, dots, dashes and underscores — no folders. The folder is decided by the data location you chose.',
    };
  }

  return { ok: true, filename, contentType: contentTypeFor(filename, cfg.contentType) };
}

/**
 * Content type from the name unless the author was explicit. A `.json` file served as text/plain is
 * the kind of thing that works until another system tries to read it.
 */
export function contentTypeFor(filename: string, explicit?: string): string {
  const given = (explicit ?? '').trim();
  if (given) return given;
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const known: Record<string, string> = {
    json: 'application/json',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    xml: 'application/xml',
  };
  return known[ext] ?? 'text/plain';
}

/** One line for the run's step detail, naming the destination in the reader's terms. */
export function describeObjectWrite(domainLabel: string, key: string, bytes: number): string {
  return `Saved ${bytes} byte${bytes === 1 ? '' : 's'} to ${domainLabel} as ${key}.`;
}
