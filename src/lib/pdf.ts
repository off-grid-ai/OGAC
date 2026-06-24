import { PDFDocument, StandardFonts } from 'pdf-lib';

// Minimal, dependency-light Markdown→PDF for report exports (pure JS, no headless browser, no fees).
// It is not a full Markdown renderer — it lays the report text out as monospaced lines with simple
// heading emphasis, which is enough for an auditable, signable artifact. The signed C2PA-style
// provenance lives in a detached manifest (src/lib/provenance.ts), not in the PDF itself.
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;
const MARGIN = 48;
const PAGE = { w: 612, h: 792 }; // US Letter, points
const MAX_CHARS = 95; // wrap width at this font on a Letter page

function wrap(line: string): string[] {
  if (line.length <= MAX_CHARS) return [line];
  const words = line.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > MAX_CHARS) {
      if (cur) out.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export async function markdownToPdf(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('offgrid-console');
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);

  const lines = body.replace(/\r/g, '').split('\n').flatMap(wrap);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  for (const raw of lines) {
    if (y < MARGIN) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
    }
    const isHeading = raw.startsWith('#');
    const text = raw.replace(/^#+\s*/, '');
    page.drawText(text, { x: MARGIN, y, size: FONT_SIZE, font: isHeading ? bold : font });
    y -= LINE_HEIGHT;
  }
  return doc.save();
}
