import { randomUUID } from 'crypto';
import { getLineage } from '@/lib/adapters/registry';
import { addDocument, type BrainDoc } from '@/lib/brain';
import { GATEWAY_URL, gatewayHeaders } from '@/lib/gateway';
import type { DocAcl } from '@/lib/retrieval/acl';
import { listDatasets } from '@/lib/store';

// The Brain's ingestion layer: turn a source (text, file, image, database) into an indexed,
// provenance-tagged document. Files/text are stored directly; images are captioned via the
// gateway (multimodal) then indexed; a database row becomes a textual record. Everything funnels
// through addDocument() so chunking/embedding/storage stays in one place.
const VISION_MODEL = process.env.OFFGRID_VISION_MODEL ?? 'gemma-local';

// Record source→document lineage through the lineage port (no-op by default, Marquez when
// configured). Funnels every ingest path so the provenance graph stays complete. brain.ingest
// KNOWS the shape of an indexed document, so it emits a real OpenLineage schema facet (the doc's
// fields) plus a dataQuality metric (indexed character count) on the output dataset — a bare
// event only names the datasets; the facet lets Marquez render the document's structure.
async function recordIngest(source: string, doc: BrainDoc): Promise<BrainDoc> {
  await getLineage().emit({
    job: 'brain.ingest',
    run: randomUUID(),
    status: 'COMPLETE',
    inputs: [source],
    outputs: [doc.title],
    facets: [
      {
        name: doc.title,
        fields: [
          { name: 'id', type: 'string', description: 'stable document id' },
          { name: 'title', type: 'string', description: 'document title' },
          { name: 'source', type: 'string', description: 'origin (text/file/image/database)' },
          { name: 'text', type: 'string', description: 'indexed, embedded content' },
        ],
        dataQuality: {
          rowCount: 1,
          byteCount: doc.text.length,
          columns: { text: { count: doc.text.length } },
        },
      },
    ],
  });
  return doc;
}

export type IngestKind = 'text' | 'file' | 'image' | 'database';

// Caption an image through the gateway's multimodal chat. Returns '' on failure so the caller
// can fall back to the filename — ingestion never hard-fails on a flaky vision model.
async function captionImage(dataUrl: string): Promise<string> {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this image thoroughly for search indexing, including any visible text.',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

// Each ingest path takes an OPTIONAL per-document ACL — when supplied, the doc is stored with owner
// / allowed_roles / allowed_subjects / data_class and permissions-aware retrieval enforces it.
// Omitting `acl` keeps the doc un-ACL'd (visible to all), exactly as before.
export async function ingestText(
  title: string,
  text: string,
  source = 'Text',
  acl?: DocAcl,
): Promise<BrainDoc> {
  return recordIngest(source, await addDocument(title, source, text, acl));
}

export async function ingestFile(name: string, text: string, acl?: DocAcl): Promise<BrainDoc> {
  return recordIngest(`File · ${name}`, await addDocument(name, `File · ${name}`, text, acl));
}

export async function ingestImage(title: string, dataUrl: string, acl?: DocAcl): Promise<BrainDoc> {
  const caption = await captionImage(dataUrl);
  const text = caption || `Image: ${title} (no caption — vision model unavailable).`;
  return recordIngest(`Image · ${title}`, await addDocument(title, `Image · ${title}`, text, acl));
}

export async function ingestDatabase(datasetId: string, acl?: DocAcl): Promise<BrainDoc | null> {
  const dataset = (await listDatasets()).find((d) => d.id === datasetId);
  if (!dataset) return null;
  const text =
    `Dataset "${dataset.name}" from ${dataset.source}: ${dataset.rows.toLocaleString()} rows, ` +
    `classification ${dataset.classification}. Structured records available for query.`;
  const source = `Database · ${dataset.source}`;
  return recordIngest(source, await addDocument(dataset.name, source, text, acl));
}
