// PURE, zero-I/O formatting of organizational-brain citations into the flat text an agent tool
// observation carries. Kept separate from the adapter so it is exhaustively unit-testable with real
// data and no I/O. Imports only the citation TYPE (no runtime dependency on the Onyx boundary).

import type { BrainCitation } from '@/lib/organizational-brain/contracts';

/**
 * Render retrieved organizational-brain citations as the tool output string the run records. Each
 * citation becomes a numbered block: title, then (when present) its excerpt and provenance URI. An
 * empty result set is reported honestly rather than as a blank string.
 */
export function formatBrainCitations(citations: readonly BrainCitation[]): string {
  if (citations.length === 0) {
    return 'No matching passages found in the organizational brain.';
  }
  return citations
    .map((citation, index) => {
      const lines = [`${index + 1}. ${citation.title}`];
      const excerpt = citation.excerpt.trim();
      if (excerpt) lines.push(`   ${excerpt}`);
      if (citation.provenanceUri) lines.push(`   source: ${citation.provenanceUri}`);
      return lines.join('\n');
    })
    .join('\n');
}
