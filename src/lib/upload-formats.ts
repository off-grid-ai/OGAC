// ─── Which uploads we can read, and what to say when we cannot — PURE ──────────────────────────────
//
// Split out of document-text.ts so CLIENT components can import the accept-list and the refusal wording
// without pulling pdfjs (~1MB) into a browser bundle. Zero imports, so it is trivially unit-testable.

const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.log',
  '.yaml',
  '.yml',
  '.htm',
  '.html',
  '.xml',
  '.sql',
];

/** The formats a person can actually upload today — used for the file picker's accept list and the copy. */
export const SUPPORTED_UPLOAD_ACCEPT = `.pdf,${TEXT_EXTENSIONS.join(',')},text/*,application/pdf`;

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** PURE: which reader a (name, mime) pair needs. Separated so the routing rule is testable with no bytes. */
export function classifyUpload(name: string, mime: string): 'pdf' | 'text' | 'unsupported' {
  const ext = extensionOf(name);
  const m = (mime || '').toLowerCase();
  if (ext === '.pdf' || m === 'application/pdf') return 'pdf';
  if (TEXT_EXTENSIONS.includes(ext) || m.startsWith('text/')) return 'text';
  if (m === 'application/json' || m === 'application/xml') return 'text';
  return 'unsupported';
}

/** PURE: the sentence shown when a format cannot be read yet. Names the format — never "unsupported file". */
export function refusalFor(name: string): string {
  const ext = extensionOf(name) || 'that format';
  const known: Record<string, string> = {
    '.docx': 'Word documents',
    '.doc': 'Word documents',
    '.xlsx': 'Excel workbooks',
    '.xls': 'Excel workbooks',
    '.pptx': 'PowerPoint decks',
    '.png': 'images',
    '.jpg': 'images',
    '.jpeg': 'images',
    '.zip': 'archives',
  };
  const label = known[ext] ?? ext;
  return `We can't read ${label} yet. Save it as PDF, text or Markdown and upload that — or paste the text with "Add text".`;
}

