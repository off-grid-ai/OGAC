import {
  resolveConnectorObjectBinding,
  type ConnectorObjectBinding,
  type ConnectorObjectBindingFailure,
} from '@/lib/adapters/s3-connector-binding';
import {
  MAX_OBJECT_SOURCE_AGGREGATE_BYTES,
  fullObjectSourceKey,
  fullObjectSourcePrefix,
  materializeObjectSourceRow,
  normalizeObjectSourceQuery,
  selectListedObjectKeys,
  sameObjectSourceDetail,
  validateObjectSourceAggregate,
  validateObjectSourceDetail,
  type ObjectSourceQueryFailure,
  type ObjectSourceQueryFailureCode,
  type ObjectSourceRow,
} from '@/lib/object-source-query';
import { scopedObjectKey } from '@/lib/object-store';

export interface S3ObjectCountRow {
  count: number;
  prefix: string;
  truncated: boolean;
  scope: {
    connectorId: string;
    domainId: string;
    bucket: string;
  };
}

export interface S3ObjectQueryResult {
  rows: Array<ObjectSourceRow | S3ObjectCountRow>;
  count: number;
  dialect: 's3';
  detail: string;
}

export type S3ObjectQueryFailureCode =
  ConnectorObjectBindingFailure | ObjectSourceQueryFailureCode | 'source-unavailable';

export type S3ObjectQueryOutcome =
  | { ok: true; result: S3ObjectQueryResult }
  | { ok: false; error: { code: S3ObjectQueryFailureCode; message: string } };

function failed(error: ObjectSourceQueryFailure): S3ObjectQueryOutcome;
function failed(code: S3ObjectQueryFailureCode, message: string): S3ObjectQueryOutcome;
function failed(
  codeOrError: S3ObjectQueryFailureCode | ObjectSourceQueryFailure,
  message?: string,
): S3ObjectQueryOutcome {
  return typeof codeOrError === 'string'
    ? { ok: false, error: { code: codeOrError, message: message ?? 'Object query failed.' } }
    : { ok: false, error: codeOrError };
}

function detail(binding: ConnectorObjectBinding, count: number, op: 'read' | 'count'): string {
  return `data-domain "${binding.scope.domainLabel}" [${binding.scope.domainId}] → connector ${binding.connector.id} :: ${binding.scope.bucket}/${binding.scope.prefix} (${op}) → ok(${count} object${count === 1 ? '' : 's'} via s3)`;
}

/**
 * Execute a query against an already-authorized binding. Metadata for every selected object is
 * validated before any body is downloaded; any mismatch/failure discards the whole result.
 */
export async function queryBoundS3ObjectSource(
  binding: ConnectorObjectBinding,
  input: {
    op?: 'read' | 'count';
    limit?: number;
    params?: Record<string, unknown>;
  },
): Promise<S3ObjectQueryOutcome> {
  const query = normalizeObjectSourceQuery(input);
  if (!query.ok) return failed(query.error);

  try {
    if (query.value.op === 'count') {
      const prefix = fullObjectSourcePrefix(binding.scope, query.value.prefix);
      if (!prefix.ok) return failed(prefix.error);
      const listing = await binding.store.listObjects(binding.scope.bucket, {
        prefix: prefix.value,
        delimiter: '',
        maxKeys: query.value.limit,
      });
      const selected = selectListedObjectKeys(
        binding.scope,
        listing,
        query.value.limit,
        prefix.value,
      );
      if (!selected.ok) return failed(selected.error);
      const row: S3ObjectCountRow = {
        count: selected.value.length,
        prefix: query.value.prefix,
        truncated: Boolean(listing.nextToken),
        scope: {
          connectorId: binding.scope.connectorId,
          domainId: binding.scope.domainId,
          bucket: binding.scope.bucket,
        },
      };
      return {
        ok: true,
        result: {
          rows: [row],
          count: row.count,
          dialect: 's3',
          detail: detail(binding, row.count, 'count'),
        },
      };
    }

    let keys: string[];
    if (query.value.key) {
      const key = fullObjectSourceKey(binding.scope, query.value.key);
      if (!key.ok) return failed(key.error);
      keys = [key.value];
    } else {
      const prefix = fullObjectSourcePrefix(binding.scope, query.value.prefix);
      if (!prefix.ok) return failed(prefix.error);
      const listing = await binding.store.listObjects(binding.scope.bucket, {
        prefix: prefix.value,
        delimiter: '',
        maxKeys: query.value.limit,
      });
      const selected = selectListedObjectKeys(
        binding.scope,
        listing,
        query.value.limit,
        prefix.value,
      );
      if (!selected.ok) return failed(selected.error);
      keys = selected.value;
    }

    const details = [];
    let declaredBytes = 0;
    for (const key of keys) {
      const object = await binding.store.headObject(binding.scope.bucket, key);
      if (!object) return failed('source-unavailable', 'Object metadata is unavailable.');
      const approved = validateObjectSourceDetail(object);
      if (!approved.ok) return failed(approved.error);
      declaredBytes += approved.value.size;
      if (declaredBytes > MAX_OBJECT_SOURCE_AGGREGATE_BYTES) {
        return failed(
          'aggregate-too-large',
          `Object retrieval is limited to ${MAX_OBJECT_SOURCE_AGGREGATE_BYTES} bytes in total.`,
        );
      }
      details.push(object);
    }

    const rows: ObjectSourceRow[] = [];
    for (const object of details) {
      const downloaded = await binding.store.getObject(binding.scope.bucket, object.key);
      if (!downloaded) return failed('source-unavailable', 'Object content is unavailable.');
      const after = await binding.store.headObject(binding.scope.bucket, object.key);
      if (!after || !sameObjectSourceDetail(object, after)) {
        return failed(
          'source-changed',
          'Object metadata changed during retrieval; retry the query.',
        );
      }
      const row = materializeObjectSourceRow({
        scope: binding.scope,
        detail: after,
        bytes: downloaded.bytes,
        getContentType: downloaded.contentType,
      });
      if (!row.ok) return failed(row.error);
      rows.push(row.value);
    }
    const aggregate = validateObjectSourceAggregate(rows);
    if (!aggregate.ok) return failed(aggregate.error);
    return {
      ok: true,
      result: {
        rows,
        count: rows.length,
        dialect: 's3',
        detail: detail(binding, rows.length, 'read'),
      },
    };
  } catch {
    return failed('source-unavailable', 'The approved object source is unavailable.');
  }
}

/** Resolve tenant/domain/credential ownership first; untrusted callers never construct a binding. */
export async function queryGovernedObjectSource(input: {
  orgId: string;
  connectorId: string;
  domainId: string;
  op?: 'read' | 'count';
  limit?: number;
  params?: Record<string, unknown>;
}): Promise<S3ObjectQueryOutcome> {
  try {
    const binding = await resolveConnectorObjectBinding(input);
    return queryBoundS3ObjectSource(binding, input);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      const code = (error as { code: ConnectorObjectBindingFailure }).code;
      if (
        ['unknown-source', 'not-object-store', 'unapproved-scope', 'missing-credential'].includes(
          code,
        )
      ) {
        return failed(
          code,
          error instanceof Error ? error.message : 'Object source is unavailable.',
        );
      }
    }
    return failed('source-unavailable', 'The approved object source is unavailable.');
  }
}

// ─── The WRITE half ──────────────────────────────────────────────────────────────────────────────
//
// Governed object READ deliberately refuses to let a caller name a bucket — the data domain owns the
// bucket and prefix, the connector owns the credential, the tenant owns both. A write that accepted a
// bucket from step config would hand straight back the authority the read path is built to withhold:
// an app could be edited to write anywhere that keypair reaches, including over its own source data.
//
// So this takes a domain and a single file NAME. The bucket and prefix are derived from the same
// binding the read uses, and scopedObjectKey is what refuses a name that tries to leave the prefix.

export type ObjectWriteFailureCode = S3ObjectQueryFailureCode | 'write-failed';

export type ObjectWriteOutcome =
  | { ok: true; result: { bucket: string; key: string; bytes: number; domainLabel: string } }
  | { ok: false; error: { code: ObjectWriteFailureCode; message: string } };

/** Write one object inside an approved data domain. The destination is derived, never supplied. */
export async function writeGovernedObject(input: {
  orgId: string;
  connectorId: string;
  domainId: string;
  /** A single path segment — validated by the pure policy before this is called. */
  filename: string;
  body: string;
  contentType: string;
}): Promise<ObjectWriteOutcome> {
  try {
    const binding = await resolveConnectorObjectBinding(input);
    const scoped = scopedObjectKey(binding.scope, input.filename);
    if (!scoped.ok) {
      return { ok: false, error: { code: 'scope-denied', message: scoped.error } };
    }
    const bytes = Buffer.from(input.body, 'utf8');
    await binding.store.putObject(
      binding.scope.bucket,
      scoped.key,
      bytes,
      input.contentType,
    );
    return {
      ok: true,
      result: {
        bucket: binding.scope.bucket,
        key: scoped.key,
        bytes: bytes.length,
        domainLabel: binding.scope.domainLabel,
      },
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code: ConnectorObjectBindingFailure }).code
        : null;
    if (code && ['unknown-source', 'not-object-store', 'unapproved-scope', 'missing-credential'].includes(code)) {
      return {
        ok: false,
        error: { code, message: error instanceof Error ? error.message : 'Object source is unavailable.' },
      };
    }
    return {
      ok: false,
      error: {
        code: 'write-failed',
        message: error instanceof Error ? error.message : 'The object could not be written.',
      },
    };
  }
}
