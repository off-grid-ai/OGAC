// Docs registry - assembles the sidebar from per-section files. Public API is unchanged from the
// old single-file module (DOC_SECTIONS, DocPage, DocSection, findDocBySlug, allDocSlugs, docIndex),
// so importers keep working. Each section lives in its own file so pages can be expanded in
// parallel without collisions.
import { apiSection } from './api';
import { conceptsSection } from './concepts';
import { buildSection } from './guides-build';
import { governSection } from './guides-govern';
import { operateSection } from './guides-operate';
import { integrationsSection } from './integrations';
import { introductionSection } from './introduction';
import { pipelinesGatewaysSection } from './pipelines-gateways';
import { selfHostingSection } from './self-hosting';
import type { DocPage, DocSection } from './types';

export type { DocPage, DocSection } from './types';

export const DOC_SECTIONS: DocSection[] = [
  introductionSection,
  conceptsSection,
  pipelinesGatewaysSection,
  buildSection,
  governSection,
  operateSection,
  integrationsSection,
  apiSection,
  selfHostingSection,
];

const ALL_PAGES: DocPage[] = DOC_SECTIONS.flatMap((s) => s.pages);

export function findDocBySlug(slug: string): DocPage | undefined {
  return ALL_PAGES.find((p) => p.slug === slug);
}

export function allDocSlugs(): string[] {
  return ALL_PAGES.map((p) => p.slug);
}

export function docIndex(): { slug: string; title: string; description: string; section: string }[] {
  return DOC_SECTIONS.flatMap((s) =>
    s.pages.map((p) => ({ slug: p.slug, title: p.title, description: p.description, section: s.label })),
  );
}

// Flat page order (sidebar order) - for prev/next footer navigation.
export function orderedDocs(): { slug: string; title: string }[] {
  return ALL_PAGES.map((p) => ({ slug: p.slug, title: p.title }));
}

export function docNeighbors(slug: string): {
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
} {
  const order = orderedDocs();
  const i = order.findIndex((p) => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return { prev: i > 0 ? order[i - 1] : null, next: i < order.length - 1 ? order[i + 1] : null };
}

// Extract on-page headings (## / ###) from a markdown body for the table of contents. Slug ids
// match the ones DocsMarkdown renders on headings, so anchor links line up.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function docHeadings(body: string): { id: string; text: string; level: 2 | 3 }[] {
  const out: { id: string; text: string; level: 2 | 3 }[] = [];
  for (const line of body.split('\n')) {
    const m = /^(##|###)\s+(.*)$/.exec(line.trim());
    if (m) {
      const text = m[2].trim();
      out.push({ id: slugifyHeading(text), text, level: m[1] === '##' ? 2 : 3 });
    }
  }
  return out;
}
