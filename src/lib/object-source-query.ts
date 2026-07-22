import { createHash } from 'node:crypto';
import type { ObjectAccessScope, ObjectDetail, ObjectListing } from '@/lib/object-store';
import { scopedObjectKey, scopedObjectPrefix } from '@/lib/object-store';

export const MAX_OBJECT_SOURCE_OBJECTS = 20;
export const MAX_OBJECT_SOURCE_BYTES = 512 * 1024;
export const MAX_OBJECT_SOURCE_AGGREGATE_BYTES = 1024 * 1024;

export const OBJECT_SOURCE_CONTENT_TYPES = new Set([
  'application/json',
  'application/x-ndjson',
  'text/csv',
  'text/markdown',
  'text/plain',
]);

export interface ObjectSourceQuery {
  op: 'read' | 'count';
  limit: number;
  key: string | null;
  prefix: string;
}

export interface ObjectSourceProvenance {
  connectorId: string;
  domainId: string;
  bucket: string;
  key: string;
  etag: string;
  lastModified: string;
  sha256: string;
}

export interface ObjectSourceRow {
  key: string;
  contentType: string;
  size: number;
  content: string;
  provenance: ObjectSourceProvenance;
}

export type ObjectSourceQueryFailureCode =
  | 'invalid-query'
  | 'scope-denied'
  | 'content-denied'
  | 'object-too-large'
  | 'aggregate-too-large'
  | 'source-changed';

export interface ObjectSourceQueryFailure {
  code: ObjectSourceQueryFailureCode;
  message: string;
}

export type ObjectSourceValidation<T> =
  { ok: true; value: T } | { ok: false; error: ObjectSourceQueryFailure };

function failure(
  code: ObjectSourceQueryFailureCode,
  message: string,
): ObjectSourceValidation<never> {
  return { ok: false, error: { code, message } };
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | null {
  const value = params?.[key];
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value.trim() : null;
}

/** Normalize generic connector-query input without admitting caller-selected ceilings. */
export function normalizeObjectSourceQuery(input: {
  op?: 'read' | 'count';
  limit?: number;
  params?: Record<string, unknown>;
}): ObjectSourceValidation<ObjectSourceQuery> {
  const op = input.op ?? 'read';
  if (op !== 'read' && op !== 'count') return failure('invalid-query', 'Unsupported object query.');
  const rawLimit = input.limit ?? MAX_OBJECT_SOURCE_OBJECTS;
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    return failure('invalid-query', 'Object query limit must be a positive integer.');
  }
  const key = stringParam(input.params, 'key');
  if (input.params?.key !== undefined && key === null) {
    return failure('invalid-query', 'Object key must be a string.');
  }
  const rawPrefix = input.params?.prefix;
  if (
    rawPrefix !== undefined &&
    rawPrefix !== null &&
    (typeof rawPrefix !== 'string' || (rawPrefix !== '' && rawPrefix.trim() === ''))
  ) {
    return failure('invalid-query', 'Object prefix must be a string.');
  }
  const prefix = typeof rawPrefix === 'string' ? rawPrefix.trim() : '';
  if (key && prefix) return failure('invalid-query', 'Choose an object key or a prefix, not both.');
  if (op === 'count' && key) {
    return failure('invalid-query', 'Count queries accept a prefix, not an object key.');
  }
  return {
    ok: true,
    value: {
      op,
      limit: Math.min(rawLimit, MAX_OBJECT_SOURCE_OBJECTS),
      key,
      prefix,
    },
  };
}

export function fullObjectSourceKey(
  scope: ObjectAccessScope,
  relativeKey: string,
): ObjectSourceValidation<string> {
  const scoped = scopedObjectKey(scope, relativeKey);
  return scoped.ok
    ? { ok: true, value: scoped.key }
    : failure('scope-denied', scoped.error ?? 'Object key is outside the approved scope.');
}

export function fullObjectSourcePrefix(
  scope: ObjectAccessScope,
  relativePrefix: string,
): ObjectSourceValidation<string> {
  const scoped = scopedObjectPrefix(scope, relativePrefix);
  return scoped.ok
    ? { ok: true, value: scoped.prefix }
    : failure('scope-denied', scoped.error ?? 'Object prefix is outside the approved scope.');
}

/** Validate every S3 listing row before selecting it; a malicious mixed-prefix page fails whole. */
export function selectListedObjectKeys(
  scope: ObjectAccessScope,
  listing: ObjectListing,
  limit: number,
): ObjectSourceValidation<string[]> {
  const keys: string[] = [];
  for (const object of listing.objects) {
    if (scope.prefix && !object.key.startsWith(scope.prefix)) {
      return failure('scope-denied', 'Object listing escaped the approved prefix.');
    }
    const relative = scope.prefix ? object.key.slice(scope.prefix.length) : object.key;
    const scoped = fullObjectSourceKey(scope, relative);
    if (!scoped.ok || scoped.value !== object.key) {
      return failure('scope-denied', 'Object listing contained an invalid scoped key.');
    }
    if (keys.length < limit) keys.push(object.key);
  }
  return { ok: true, value: keys };
}

export function validateObjectSourceDetail(
  detail: ObjectDetail,
): ObjectSourceValidation<{ contentType: string; size: number }> {
  const contentType = detail.contentType.split(';', 1)[0].trim().toLowerCase();
  if (!OBJECT_SOURCE_CONTENT_TYPES.has(contentType)) {
    return failure('content-denied', 'Object content type is not approved for App retrieval.');
  }
  if (!Number.isInteger(detail.size) || detail.size < 0 || detail.size > MAX_OBJECT_SOURCE_BYTES) {
    return failure(
      'object-too-large',
      `Object retrieval is limited to ${MAX_OBJECT_SOURCE_BYTES} bytes per object.`,
    );
  }
  return { ok: true, value: { contentType, size: detail.size } };
}

/** Exact before/after HEAD comparison used to catch a same-size object replacement during GET. */
export function sameObjectSourceDetail(before: ObjectDetail, after: ObjectDetail): boolean {
  const contentType = (value: string) => value.split(';', 1)[0].trim().toLowerCase();
  return (
    before.bucket === after.bucket &&
    before.key === after.key &&
    before.size === after.size &&
    contentType(before.contentType) === contentType(after.contentType) &&
    before.etag === after.etag &&
    before.lastModified === after.lastModified
  );
}

function decodeUtf8(bytes: Uint8Array): ObjectSourceValidation<string> {
  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return failure('content-denied', 'Object content is not valid UTF-8 text.');
  }
}

function validateStructuredText(contentType: string, content: string): boolean {
  try {
    if (contentType === 'application/json') {
      JSON.parse(content);
    } else if (contentType === 'application/x-ndjson') {
      for (const line of content.split(/\r?\n/).filter((value) => value.trim())) JSON.parse(line);
    }
    return true;
  } catch {
    return false;
  }
}

/** Build one immutable evidence row only when HEAD and GET metadata/bytes still agree. */
export function materializeObjectSourceRow(input: {
  scope: ObjectAccessScope;
  detail: ObjectDetail;
  bytes: Uint8Array;
  getContentType: string;
}): ObjectSourceValidation<ObjectSourceRow> {
  const approved = validateObjectSourceDetail(input.detail);
  if (!approved.ok) return approved;
  if (input.detail.bucket !== input.scope.bucket) {
    return failure('scope-denied', 'Object metadata escaped the approved bucket.');
  }
  const getContentType = input.getContentType.split(';', 1)[0].trim().toLowerCase();
  if (
    input.bytes.byteLength !== approved.value.size ||
    getContentType !== approved.value.contentType
  ) {
    return failure('source-changed', 'Object metadata changed during retrieval; retry the query.');
  }
  const decoded = decodeUtf8(input.bytes);
  if (!decoded.ok) return decoded;
  if (!validateStructuredText(approved.value.contentType, decoded.value)) {
    return failure('content-denied', 'Structured object content is invalid.');
  }
  if (input.scope.prefix && !input.detail.key.startsWith(input.scope.prefix)) {
    return failure('scope-denied', 'Object metadata escaped the approved prefix.');
  }
  const relativeKey = input.scope.prefix
    ? input.detail.key.slice(input.scope.prefix.length)
    : input.detail.key;
  const scoped = fullObjectSourceKey(input.scope, relativeKey);
  if (!scoped.ok || scoped.value !== input.detail.key) {
    return failure('scope-denied', 'Object metadata contains an invalid scoped key.');
  }
  return {
    ok: true,
    value: {
      key: relativeKey,
      contentType: approved.value.contentType,
      size: approved.value.size,
      content: decoded.value,
      provenance: {
        connectorId: input.scope.connectorId,
        domainId: input.scope.domainId,
        bucket: input.scope.bucket,
        key: input.detail.key,
        etag: input.detail.etag,
        lastModified: input.detail.lastModified,
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
      },
    },
  };
}

export function validateObjectSourceAggregate(
  rows: readonly ObjectSourceRow[],
): ObjectSourceValidation<readonly ObjectSourceRow[]> {
  const total = rows.reduce((sum, row) => sum + row.size, 0);
  return total <= MAX_OBJECT_SOURCE_AGGREGATE_BYTES
    ? { ok: true, value: rows }
    : failure(
        'aggregate-too-large',
        `Object retrieval is limited to ${MAX_OBJECT_SOURCE_AGGREGATE_BYTES} bytes in total.`,
      );
}
