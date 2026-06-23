import { randomUUID } from 'crypto';
import { getLineage } from '@/lib/adapters/registry';
import { addDocument, type BrainDoc } from '@/lib/brain';
import { listDatasets } from '@/lib/store';

// The Brain's ingestion layer: turn a source (text, file, image, database) into an indexed,
// provenance-tagged document. Files/text are stored directly; images are captioned via the
// gateway (multimodal) then indexed; a database row becomes a textual record. Everything funnels
// through addDocument() so chunking/embedding/storage stays in one place.
const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';
const VISION_MODEL = process.env.OFFGRID_VISION_MODEL ?? 'gemma-local';

// Record source→document lineage through the lineage port (no-op by default, Marquez when
// configured). Funnels every ingest path so the provenance graph stays complete.
async function recordIngest(source: string, doc: BrainDoc): Promise<BrainDoc> {
  await getLineage().emit({
    job: 'brain.ingest',
    run: randomUUID(),
    status: 'COMPLETE',
    inputs: [source],
    outputs: [doc.title],
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
      headers: { 'content-type': 'application/json' },
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

export async function ingestText(title: string, text: string, source = 'Text'): Promise<BrainDoc> {
  return recordIngest(source, await addDocument(title, source, text));
}

export async function ingestFile(name: string, text: string): Promise<BrainDoc> {
  return recordIngest(`File · ${name}`, await addDocument(name, `File · ${name}`, text));
}

export async function ingestImage(title: string, dataUrl: string): Promise<BrainDoc> {
  const caption = await captionImage(dataUrl);
  const text = caption || `Image: ${title} (no caption — vision model unavailable).`;
  return recordIngest(`Image · ${title}`, await addDocument(title, `Image · ${title}`, text));
}

export async function ingestDatabase(datasetId: string): Promise<BrainDoc | null> {
  const dataset = (await listDatasets()).find((d) => d.id === datasetId);
  if (!dataset) return null;
  const text =
    `Dataset "${dataset.name}" from ${dataset.source}: ${dataset.rows.toLocaleString()} rows, ` +
    `classification ${dataset.classification}. Structured records available for query.`;
  const source = `Database · ${dataset.source}`;
  return recordIngest(source, await addDocument(dataset.name, source, text));
}
