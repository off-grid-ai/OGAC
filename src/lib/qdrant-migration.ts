export interface QdrantMigrationResponse {
  ok: boolean;
  status: number;
}

export type QdrantMigrationRequest = (
  path: string,
  method: 'PUT',
  body: Record<string, unknown>,
) => Promise<QdrantMigrationResponse>;

/**
 * Upgrade pre-tenancy Brain points in place. Legacy points belong to the historic single tenant,
 * never to whichever tenant happens to query first. Qdrant's `is_empty` filter makes this
 * idempotent: after the first successful pass there are no matching points.
 */
export async function migrateLegacyQdrantPayloads(
  collection: string,
  defaultOrgId: string,
  request: QdrantMigrationRequest,
): Promise<void> {
  const response = await request(`/collections/${collection}/points/payload`, 'PUT', {
    payload: { org_id: defaultOrgId },
    filter: { must: [{ is_empty: { key: 'org_id' } }] },
  });
  if (!response.ok) {
    throw new Error(`Qdrant tenant payload migration failed (${response.status})`);
  }
}
