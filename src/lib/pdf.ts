import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont } from 'pdf-lib';

// Minimal, dependency-light Markdown→PDF for report exports (pure JS, no headless browser, no fees).
// It is not a full Markdown renderer — it lays the report text out as monospaced lines with simple
// heading emphasis, which is enough for an auditable, signable artifact. The signed C2PA-style
// provenance lives in a detached manifest (src/lib/provenance.ts), not in the PDF itself.
//
// UNICODE: report bodies routinely contain currency symbols, arrows (→), bullets, and em-dashes.
// pdf-lib's built-in StandardFonts use WinAnsi encoding, which THROWS on many of those ("WinAnsi
// cannot encode …") — breaking any non-ASCII report. We instead embed a real Unicode TrueType face
// (DejaVu Sans Mono — monospace, so the fixed-width layout below still holds) via @pdf-lib/fontkit
// and subset it so the PDF stays small. Any codepoint the face genuinely can't draw (e.g. Devanagari
// — a documented follow-up) is sanitized to a placeholder so drawText never throws; $ and → render
// for real.
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;
const MARGIN = 48;
const PAGE = { w: 612, h: 792 }; // US Letter, points
const MAX_CHARS = 95; // wrap width at this font on a Letter page

// The bundled Unicode font. It lives inside src/ so the console-source rsync in deploy/push.sh ships
// it to the server (that rsync excludes node_modules/.next/.git/env/data only — src/ is included).
// Read straight off disk at render time (the sole I/O in this module) rather than bundling bytes, so
// it works identically under `next start` where the source tree is present on disk.
const FONT_PATH = join(process.cwd(), 'src', 'lib', 'fonts', 'DejaVuSansMono.ttf');

let cachedFontBytes: Uint8Array | null = null;
function loadFontBytes(): Uint8Array {
  if (!cachedFontBytes) {
    cachedFontBytes = new Uint8Array(readFileSync(FONT_PATH));
  }
  return cachedFontBytes;
}

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

// Replace any codepoint the embedded font can't encode with a visible placeholder, so drawText never
// throws on an exotic glyph (e.g. Devanagari — not yet covered by DejaVu Sans Mono). Pure: it takes
// the font's own coverage predicate. $, →, ←, bullets and dashes ARE in the face, so they pass
// through untouched; only genuinely-uncovered codepoints and control chars are rewritten.
export function sanitizeForFont(text: string, canEncode: (codePoint: number) => boolean): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x09) {
      out += '  '; // tab → two spaces (the caller has already split on \n)
      continue;
    }
    if (cp < 0x20) continue; // drop other control chars
    out += canEncode(cp) ? ch : '?';
  }
  return out;
}

// Build a coverage predicate for the embedded font. fontkit exposes `hasGlyphForCodePoint` on the
// underlying font, reached via pdf-lib's custom-font embedder. We probe it defensively so a pdf-lib
// internals change degrades to "assume covered and let drawText's own handling apply" rather than
// crashing the whole report.
function encoderFor(font: PDFFont): (codePoint: number) => boolean {
  const fkFont: unknown = (font as unknown as { embedder?: { font?: unknown } }).embedder?.font;
  const probe =
    fkFont &&
    typeof (fkFont as { hasGlyphForCodePoint?: unknown }).hasGlyphForCodePoint === 'function'
      ? (fkFont as { hasGlyphForCodePoint: (cp: number) => boolean }).hasGlyphForCodePoint.bind(fkFont)
      : null;
  if (!probe) return () => true;
  return (cp: number) => {
    try {
      return probe(cp);
    } catch {
      return false;
    }
  };
}

export async function markdownToPdf(title: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer('offgrid-console');

  const fontBytes = loadFontBytes();
  // subset: true keeps only the glyphs actually used, so the 341KB face adds only a few KB to the PDF.
  const font = await doc.embedFont(fontBytes, { subset: true });
  const canEncode = encoderFor(font);

  const lines = body.replaceAll('\r', '').split('\n').flatMap(wrap);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;
  for (const raw of lines) {
    if (y < MARGIN) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
    }
    const isHeading = raw.startsWith('#');
    const stripped = raw.replace(/^#+\s*/, '');
    const text = sanitizeForFont(stripped, canEncode);
    // One embedded face draws both body and headings; heading emphasis is carried by the '#'-stripped
    // line standing on its own with a little extra leading (DejaVu Sans Mono is embedded as a single
    // upright face — a synthetic bold would need a second embed for marginal gain on an audit doc).
    page.drawText(text, { x: MARGIN, y, size: FONT_SIZE, font });
    y -= isHeading ? LINE_HEIGHT + 2 : LINE_HEIGHT;
  }
  return doc.save();
}
