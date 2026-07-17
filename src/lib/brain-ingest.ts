import { ingestDatabase, ingestFile, ingestImage, ingestText } from '@/lib/ingest';
import type { BrainDoc } from '@/lib/brain';

/** Tenant-scoped request contract shared by the Brain route and integration tests. */
export interface BrainIngestBody {
  kind?: string;
  title?: string;
  name?: string;
  text?: string;
  source?: string;
  dataUrl?: string;
  datasetId?: string;
}

type Handler = (body: BrainIngestBody, orgId: string) => Promise<BrainDoc | null> | undefined;

const HANDLERS: Record<string, Handler> = {
  text: (body, orgId) =>
    body.title && body.text
      ? ingestText(body.title, body.text, body.source, undefined, orgId)
      : undefined,
  file: (body, orgId) =>
    body.name && body.text ? ingestFile(body.name, body.text, undefined, orgId) : undefined,
  image: (body, orgId) =>
    body.title && body.dataUrl ? ingestImage(body.title, body.dataUrl, undefined, orgId) : undefined,
  database: (body, orgId) =>
    body.datasetId ? ingestDatabase(body.datasetId, undefined, orgId) : undefined,
};

/**
 * Dispatch an ingest only after the authenticated route has resolved its tenant. There is no
 * default org here by design: an HTTP caller can never accidentally write into `default`.
 */
export function dispatchBrainIngest(
  body: BrainIngestBody,
  orgId: string,
): Promise<BrainDoc | null> | undefined {
  const handler = HANDLERS[body.kind ?? ''];
  return handler ? handler(body, orgId) : undefined;
}
