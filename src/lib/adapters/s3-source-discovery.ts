// ─── Source discovery: what can this object source actually see? ─────────────────────────────────
//
// Configuring an S3 data domain meant typing a bucket and prefix from memory. Get it wrong and the
// domain saves cleanly and fails at RUN time, on someone else's screen, as "no records" — the failure
// class this codebase keeps having to hunt. Discovery closes that loop: pick from what is there.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
//   • It never accepts an endpoint, bucket or credential from the caller. The connector id is the only
//     input, and the endpoint and keypair are read from the stored connector and the vault. A
//     discovery call that took a URL would be a request-forgery primitive wearing an admin route.
//   • It does not return object CONTENT. Names and sizes are enough to choose a prefix, and a preview
//     would read data the caller has not yet been approved for — the data domain being configured is
//     precisely the approval that does not exist yet.
//
// So this is an ADMIN CONFIGURATION capability over a tenant's own source, not a data read. The
// governed read path (queryGovernedObjectSource) still requires an approved domain, and always will.

import { createS3ObjectStore } from '@/lib/adapters/s3-object-store';
import { getConnector } from '@/lib/connector-detail';
import { parseObjectStoreCredential } from '@/lib/connector-policy';
import { resolveConnectorSecret } from '@/lib/connector-secrets';

export type DiscoveryFailure =
  | 'unknown-source'
  | 'not-object-store'
  | 'missing-credential'
  | 'unreachable';

export type DiscoveryOutcome<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: DiscoveryFailure; message: string } };

/** Build the connector's OWN store client — its endpoint, its vaulted keypair, its tenant. */
async function storeFor(orgId: string, connectorId: string) {
  const connector = await getConnector(connectorId, orgId);
  if (!connector) {
    return { ok: false as const, error: { code: 'unknown-source' as const, message: 'This data source was not found.' } };
  }
  if ((connector.type ?? '').toLowerCase() !== 's3') {
    return { ok: false as const, error: { code: 'not-object-store' as const, message: 'This data source is not an object store.' } };
  }
  const credential = parseObjectStoreCredential(await resolveConnectorSecret(connectorId, orgId));
  if (!credential) {
    return {
      ok: false as const,
      error: {
        code: 'missing-credential' as const,
        message: 'This data source has no usable access key saved, so its contents cannot be listed.',
      },
    };
  }
  return {
    ok: true as const,
    store: createS3ObjectStore({
      endpoint: connector.endpoint,
      credential: async () => ({ kind: 's3', accessKey: credential.accessKey, secretKey: credential.secretKey }),
    }),
  };
}

export interface DiscoveredBucket {
  name: string;
  createdAt: string;
}

/** Buckets this source's own credential can see. */
export async function discoverSourceBuckets(
  orgId: string,
  connectorId: string,
): Promise<DiscoveryOutcome<DiscoveredBucket[]>> {
  const resolved = await storeFor(orgId, connectorId);
  if (!resolved.ok) return resolved;
  try {
    const buckets = await resolved.store.listBuckets();
    return { ok: true, result: buckets.map((b) => ({ name: b.name, createdAt: b.createdAt })) };
  } catch (e) {
    // Reported as unreachable, NOT as an empty list. "This source has no buckets" and "we could not
    // reach it" lead an operator to opposite conclusions, and only one of them is recoverable.
    return { ok: false, error: { code: 'unreachable', message: reachMessage(e) } };
  }
}

export interface DiscoveredPrefixes {
  bucket: string;
  prefixes: string[];
  /** Object count at this level, so an empty prefix list is distinguishable from an empty bucket. */
  objectsAtRoot: number;
}

/** Top-level folders inside one bucket, for choosing the prefix a domain will be scoped to. */
export async function discoverSourcePrefixes(
  orgId: string,
  connectorId: string,
  bucket: string,
  under = '',
): Promise<DiscoveryOutcome<DiscoveredPrefixes>> {
  const resolved = await storeFor(orgId, connectorId);
  if (!resolved.ok) return resolved;
  try {
    const listing = await resolved.store.listObjects(bucket, {
      prefix: under,
      delimiter: '/',
      maxKeys: 200,
    });
    return {
      ok: true,
      result: {
        bucket,
        prefixes: listing.folders ?? [],
        objectsAtRoot: (listing.objects ?? []).length,
      },
    };
  } catch (e) {
    return { ok: false, error: { code: 'unreachable', message: reachMessage(e) } };
  }
}

function reachMessage(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e);
  return `This data source could not be reached, so its contents are unknown (${detail.slice(0, 160)}).`;
}
