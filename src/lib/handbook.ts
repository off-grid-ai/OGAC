import { readFile } from 'fs/promises';
import { join } from 'path';

// The hosted handbook — the prose docs (integration / operations / running) served in-app at
// /handbook, alongside the API reference at /docs. Source of truth is the markdown in docs/,
// read at request time so the hosted docs never drift from the repo.
export interface HandbookDoc {
  slug: string;
  title: string;
  blurb: string;
  file: string;
}

export const HANDBOOK: HandbookDoc[] = [
  {
    slug: 'running',
    title: 'Running the full stack',
    blurb: 'One command for all five layers; profiles, ports, variants.',
    file: 'RUNNING.md',
  },
  {
    slug: 'integrations',
    title: 'Integrations (adapter layer)',
    blurb: 'Capability ports, swapping a tool, the full capability map.',
    file: 'INTEGRATIONS.md',
  },
  {
    slug: 'operations',
    title: 'Operations runbook',
    blurb: 'Every integration: how it works, how to operate, verify, swap.',
    file: 'OPERATIONS.md',
  },
  {
    slug: 'licenses',
    title: 'Licensing & legal',
    blurb: 'Dual-license model and the permissive OSS audit.',
    file: 'LICENSES.md',
  },
];

export function findDoc(slug: string): HandbookDoc | undefined {
  return HANDBOOK.find((d) => d.slug === slug);
}

export async function readDoc(doc: HandbookDoc): Promise<string> {
  try {
    return await readFile(join(process.cwd(), 'docs', doc.file), 'utf8');
  } catch {
    return `# ${doc.title}\n\n_Document not found._`;
  }
}
