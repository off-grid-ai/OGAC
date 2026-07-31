// ─── Getting text OUT of an uploaded file, so it can be indexed ────────────────────────────────────
//
// LIVE FINDING (2026-07-31). The founder asked "do you support PDFs as well?" — and the honest answer was
// no. Both knowledge upload paths did `await file.text()`, which on a PDF yields the container bytes as
// mojibake ("%PDF-1.7 … stream …"). That does not fail: it indexes, reports a chunk count, and produces a
// document whose citations are garbage. Worse than a rejection, because nothing tells anyone.
//
// So extraction is explicit and typed. Per format:
//   • text/plain, .md, .csv, .json, .log, .yaml — decoded as UTF-8.
//   • PDF — pdfjs (already a dependency), page by page, text items joined.
//   • anything else — REFUSED with a reason naming the format, so the caller shows "we can't read a .docx
//     yet" instead of indexing noise.
//
// The extension AND the mime are considered, because browsers report application/octet-stream for plenty
// of ordinary files and a .pdf renamed to .txt is still a PDF.

import { classifyUpload, refusalFor } from '@/lib/upload-formats';

export interface ExtractedText {
  text: string;
  /** Page count for a PDF; undefined for plain text. Shown in the upload toast. */
  pages?: number;
}

export interface ExtractionRefusal {
  refused: true;
  /** User-facing sentence naming the format and what to do instead. */
  reason: string;
}

export type ExtractionResult = ExtractedText | ExtractionRefusal;

export function isRefusal(r: ExtractionResult): r is ExtractionRefusal {
  return (r as ExtractionRefusal).refused === true;
}

// Collapse the runs of whitespace pdfjs produces between text items, without destroying paragraphs.
function tidy(text: string): string {
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  // Dynamic import: pdfjs is ~1MB and only this path needs it, so it stays out of every other route's
  // module graph. The legacy build is the one that runs under Node without a DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    parts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim(),
    );
  }
  const text = tidy(parts.join('\n\n'));
  if (!text) {
    // A scanned PDF is images. Saying "0 chunks" would look like our bug; say what is actually true.
    return {
      refused: true,
      reason:
        'This PDF has no selectable text — it looks like a scan. Upload a text-based PDF, or paste the text with "Add text".',
    };
  }
  return { text, pages: doc.numPages };
}

/** Read an uploaded file's text. I/O only at the format boundary; every decision above is pure. */
export async function extractDocumentText(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ExtractionResult> {
  const kind = classifyUpload(name, mime);
  if (kind === 'unsupported') return { refused: true, reason: refusalFor(name) };
  if (kind === 'pdf') return extractPdf(bytes);
  const text = tidy(new TextDecoder('utf-8').decode(bytes));
  if (!text) return { refused: true, reason: 'That file is empty.' };
  return { text };
}
