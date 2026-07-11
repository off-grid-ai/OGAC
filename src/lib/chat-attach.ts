import { inflateSync } from 'node:zlib';
import { neutralizeForContextBlock } from './chat-mentions';

// Ad-hoc chat file attachments — server-side text extraction so PDF/CSV/TXT/MD attachments can be
// injected as context for a single turn (parity with ChatGPT/Claude file attach). No new
// dependencies: text formats are read directly, PDFs are parsed with a light, pure-JS extractor
// (zlib for FlateDecode streams + text-operator scraping). Best-effort — scanned/image-only PDFs
// yield little text, which we surface to the caller rather than failing the chat.

const MAX_CHARS = 24_000; // cap injected context per file so we don't blow the model window

export type Extracted = { name: string; text: string; truncated: boolean };

// Decode a PDF's content streams and scrape text from Tj / TJ show operators. This is intentionally
// simple: it recovers the readable text of most text-based PDFs without a heavyweight dependency.
// eslint-disable-next-line complexity
function extractPdf(buf: Buffer): string {
  const out: string[] = [];
  // Walk every `stream ... endstream` block; inflate FlateDecode, keep raw otherwise.
  let idx = 0;
  for (;;) {
    const s = buf.indexOf('stream', idx);
    if (s < 0) break;
    const e = buf.indexOf('endstream', s);
    if (e < 0) break;
    // Content starts after the `stream` keyword and its trailing EOL (CRLF or LF).
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    let end = e;
    if (buf[end - 1] === 0x0a) end--;
    if (buf[end - 1] === 0x0d) end--;
    const raw = buf.subarray(start, end);
    idx = e + 9;
    let content: Buffer;
    try {
      content = inflateSync(raw);
    } catch {
      content = raw; // not FlateDecode (or already plain) — scrape as-is
    }
    out.push(scrapeTextOperators(content.toString('latin1')));
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Pull the literal strings out of `(...) Tj` and `[...] TJ` text-showing operators.
function scrapeTextOperators(s: string): string {
  const pieces: string[] = [];
  // Match parenthesised strings, honoring escaped parens.
  const re = /\((?:\\.|[^\\()])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const lit = m[0]
      .slice(1, -1)
      .replace(/\\([nrtbf()\\])/g, (_x, c) => {
        const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };
        return map[c] ?? c;
      })
      .replace(/\\[0-7]{1,3}/g, (o) => String.fromCharCode(Number.parseInt(o.slice(1), 8)));
    if (lit) pieces.push(lit);
  }
  return pieces.join(' ');
}

// Extract readable text from one uploaded file by name + kind + base64/raw content.
export function extractFile(name: string, mime: string, dataBase64: string): Extracted {
  const lower = name.toLowerCase();
  const isPdf = mime === 'application/pdf' || lower.endsWith('.pdf');
  let text = '';
  if (isPdf) {
    text = extractPdf(Buffer.from(dataBase64, 'base64'));
  } else {
    // Text formats (txt/md/csv/json/tsv/log) are decoded directly as UTF-8.
    text = Buffer.from(dataBase64, 'base64').toString('utf8');
  }
  const truncated = text.length > MAX_CHARS;
  return { name, text: truncated ? `${text.slice(0, MAX_CHARS)}\n…[truncated]` : text, truncated };
}

// Format extracted files as a system context block for the turn.
export function attachmentBlock(files: Extracted[]): string {
  const usable = files.filter((f) => f.text.trim());
  if (!usable.length) return '';
  // Both the filename (an attribute value) and the extracted text are untrusted, user-controlled
  // content. Neutralize them so a crafted name/body can't close the `name="…"` attribute, the
  // <file> tag, or the <attached_files> wrapper and inject its own <system> instruction into what
  // the model reads as trusted context (prompt-injection / context-boundary break).
  const body = usable
    .map(
      (f) =>
        `<file name="${neutralizeForContextBlock(f.name)}">\n${neutralizeForContextBlock(f.text)}\n</file>`,
    )
    .join('\n\n');
  return `<attached_files>\nThe user attached these files to this message. Use them as context:\n\n${body}\n</attached_files>`;
}
