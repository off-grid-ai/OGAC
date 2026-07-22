import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import {
  ConnectorObjectBindingError,
  resolveConnectorObjectBinding,
} from '@/lib/adapters/s3-connector-binding';
import { requireAdmin } from '@/lib/authz';
import {
  keyBasename,
  MAX_OBJECT_INLINE_READ_BYTES,
  MAX_OBJECT_LIST_ITEMS,
  MAX_OBJECT_UPLOAD_BYTES,
  relativeObjectKey,
  scopedObjectKey,
  scopedObjectPrefix,
  validateObjectUpload,
} from '@/lib/object-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

function bindingFailure(error: unknown): NextResponse {
  if (!(error instanceof ConnectorObjectBindingError)) {
    return privateJson({ error: 'The object source could not be reached.' }, { status: 502 });
  }
  const status =
    error.code === 'unknown-source' ? 404 : error.code === 'unapproved-scope' ? 403 : 409;
  return privateJson({ error: error.message, code: error.code }, { status });
}

async function binding(req: Request, connectorId: string) {
  const domainId = new URL(req.url).searchParams.get('domain')?.trim() ?? '';
  if (!domainId) {
    throw new ConnectorObjectBindingError('unapproved-scope', 'Choose an approved object scope.');
  }
  const orgId = await currentOrgId();
  const resolved = await resolveConnectorObjectBinding({ orgId, connectorId, domainId });
  return { ...resolved, orgId };
}

function sourceEvidence(resolved: Awaited<ReturnType<typeof binding>>) {
  return {
    connectorId: resolved.connector.id,
    connectorName: resolved.connector.name,
    domainId: resolved.scope.domainId,
    domainLabel: resolved.scope.domainLabel,
    bucket: resolved.scope.bucket,
    prefix: resolved.scope.prefix,
  };
}

async function readBodyBounded(req: Request): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_OBJECT_UPLOAD_BYTES) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_OBJECT_UPLOAD_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, size);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { id } = await params;
    const resolved = await binding(req, id);
    const url = new URL(req.url);
    const relativeKey = url.searchParams.get('key');
    if (relativeKey !== null) {
      const scoped = scopedObjectKey(resolved.scope, relativeKey);
      if (!scoped.ok) return privateJson({ error: scoped.error }, { status: 400 });
      const detail = await resolved.store.headObject(resolved.scope.bucket, scoped.key);
      if (!detail) return privateJson({ error: 'Object not found.' }, { status: 404 });
      if (url.searchParams.has('download')) {
        if (detail.size > MAX_OBJECT_INLINE_READ_BYTES) {
          return privateJson(
            {
              error: `Downloads through the console are limited to ${MAX_OBJECT_INLINE_READ_BYTES} bytes.`,
            },
            { status: 413 },
          );
        }
        const object = await resolved.store.getObject(resolved.scope.bucket, scoped.key);
        if (!object) return privateJson({ error: 'Object not found.' }, { status: 404 });
        if (object.bytes.length > MAX_OBJECT_INLINE_READ_BYTES) {
          return privateJson(
            {
              error: `Downloads through the console are limited to ${MAX_OBJECT_INLINE_READ_BYTES} bytes.`,
            },
            { status: 413 },
          );
        }
        auditFromSession(gate, resolved.orgId, {
          action: 'connector.object.download',
          resource: `connector:${id}/domain:${resolved.scope.domainId}/object:${scoped.key}`,
          outcome: 'ok',
        });
        return new Response(new Uint8Array(object.bytes) as BodyInit, {
          headers: {
            'cache-control': 'private, no-store',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(keyBasename(relativeKey))}`,
            'content-length': String(object.bytes.length),
            'content-type': object.contentType || 'application/octet-stream',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      auditFromSession(gate, resolved.orgId, {
        action: 'connector.object.inspect',
        resource: `connector:${id}/domain:${resolved.scope.domainId}/object:${scoped.key}`,
        outcome: 'ok',
      });
      return privateJson({
        source: sourceEvidence(resolved),
        object: { ...detail, key: relativeKey },
      });
    }

    const relativePrefix = url.searchParams.get('prefix') ?? '';
    const scoped = scopedObjectPrefix(resolved.scope, relativePrefix);
    if (!scoped.ok) return privateJson({ error: scoped.error }, { status: 400 });
    const listing = await resolved.store.listObjects(resolved.scope.bucket, {
      prefix: scoped.prefix,
      delimiter: '/',
      token: url.searchParams.get('token') ?? undefined,
      maxKeys: MAX_OBJECT_LIST_ITEMS,
    });
    const objects = listing.objects
      .flatMap((object) => {
        const key = relativeObjectKey(resolved.scope, object.key);
        return key === null ? [] : [{ ...object, key }];
      })
      .slice(0, MAX_OBJECT_LIST_ITEMS);
    const folders = listing.folders
      .flatMap((folder) => {
        const key = relativeObjectKey(resolved.scope, folder);
        return key === null ? [] : [key];
      })
      .slice(0, MAX_OBJECT_LIST_ITEMS);
    auditFromSession(gate, resolved.orgId, {
      action: 'connector.object.list',
      resource: `connector:${id}/domain:${resolved.scope.domainId}/prefix:${scoped.prefix}`,
      outcome: 'ok',
    });
    return privateJson({
      source: sourceEvidence(resolved),
      prefix: relativePrefix,
      folders,
      objects,
      nextToken: listing.nextToken,
    });
  } catch (error) {
    return bindingFailure(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { id } = await params;
    const resolved = await binding(req, id);
    const relativeKey = new URL(req.url).searchParams.get('key') ?? '';
    const scoped = scopedObjectKey(resolved.scope, relativeKey);
    if (!scoped.ok) return privateJson({ error: scoped.error }, { status: 400 });
    const body = await readBodyBounded(req);
    if (!body) return privateJson({ error: 'File exceeds the upload limit.' }, { status: 413 });
    const contentType = req.headers.get('content-type') ?? 'application/octet-stream';
    const allowed = validateObjectUpload({ relativeKey, size: body.length, contentType });
    if (!allowed.ok) return privateJson({ error: allowed.error }, { status: 400 });
    await resolved.store.putObject(
      resolved.scope.bucket,
      scoped.key,
      body,
      contentType.split(';', 1)[0].trim().toLowerCase(),
      { 'offgrid-org': resolved.orgId, 'offgrid-domain': resolved.scope.domainId },
    );
    auditFromSession(gate, resolved.orgId, {
      action: 'connector.object.put',
      resource: `connector:${id}/domain:${resolved.scope.domainId}/object:${scoped.key}`,
      outcome: 'ok',
    });
    return privateJson(
      { source: sourceEvidence(resolved), object: { key: relativeKey, bytes: body.length } },
      { status: 201 },
    );
  } catch (error) {
    return bindingFailure(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  try {
    const { id } = await params;
    const resolved = await binding(req, id);
    const relativeKey = new URL(req.url).searchParams.get('key') ?? '';
    const scoped = scopedObjectKey(resolved.scope, relativeKey);
    if (!scoped.ok) return privateJson({ error: scoped.error }, { status: 400 });
    const exists = await resolved.store.headObject(resolved.scope.bucket, scoped.key);
    if (!exists) return privateJson({ error: 'Object not found.' }, { status: 404 });
    const deleted = await resolved.store.deleteObject(resolved.scope.bucket, scoped.key);
    auditFromSession(gate, resolved.orgId, {
      action: 'connector.object.delete',
      resource: `connector:${id}/domain:${resolved.scope.domainId}/object:${scoped.key}`,
      outcome: deleted ? 'ok' : 'error',
    });
    return deleted
      ? privateJson({ deleted: true, source: sourceEvidence(resolved), key: relativeKey })
      : privateJson({ error: 'Object could not be deleted.' }, { status: 502 });
  } catch (error) {
    return bindingFailure(error);
  }
}
