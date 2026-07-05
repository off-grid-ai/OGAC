// Docs registry — assembles the sidebar from per-section files. Public API is unchanged from the
// old single-file module (DOC_SECTIONS, DocPage, DocSection, findDocBySlug, allDocSlugs, docIndex),
// so importers keep working. Each section lives in its own file so pages can be expanded in
// parallel without collisions.
import { conceptsSection } from './concepts';
import { integrationsSection } from './integrations';
import { introductionSection } from './introduction';
import { apiSection } from './api';
import { buildSection } from './guides-build';
import { governSection } from './guides-govern';
import { operateSection } from './guides-operate';
import { selfHostingSection } from './self-hosting';
import type { DocPage, DocSection } from './types';

export type { DocPage, DocSection } from './types';

export const DOC_SECTIONS: DocSection[] = [
  introductionSection,
  conceptsSection,
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
