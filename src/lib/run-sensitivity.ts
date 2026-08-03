// ─── How sensitive was the data this run read — PURE ───────────────────────────────────────────────
//
// The CISO's question: "which models processed data classified Confidential or above?" It failed for a
// precise reason worth recording — classification EXISTED and was populated (23 rows over 12 assets),
// but on `data_assets`, which catalogues the WAREHOUSE. Apps read DATA DOMAINS bound to operational
// connectors. Nothing joined the two inventories (0 of 16 assets carried a domain id, and no name
// match exists between `bharatunion.dim_customer` and `bhcon_corebank/customers`).
//
// So the level is now carried by the domain — the thing an app actually binds to — and a run inherits
// the HIGHEST level across everything it read. Highest, not average: a run that touched one restricted
// field is a restricted run, and averaging would hide exactly the case a regulator cares about.
//
// UNCLASSIFIED IS NOT PUBLIC. A domain nobody has graded returns null and the run is reported as
// "partly unclassified" rather than being quietly floored to public — which is how an ungoverned
// source ends up looking safe.

import { levelRank, normalizeLevel, type ClassificationLevel } from '@/lib/data-classification';

export interface RunSensitivity {
  /** The highest level read, or null when nothing the run read has been classified. */
  level: ClassificationLevel | null;
  /** Domains the run read that carry no classification — the honest gap in the answer. */
  unclassified: string[];
  /** Every distinct level touched, most sensitive first. */
  levels: ClassificationLevel[];
}

export interface DomainLevel {
  label: string;
  classification?: string | null;
}

export function runSensitivity(domains: DomainLevel[]): RunSensitivity {
  const levels: ClassificationLevel[] = [];
  const unclassified: string[] = [];
  for (const d of domains) {
    const raw = d.classification?.trim();
    if (!raw) {
      unclassified.push(d.label);
      continue;
    }
    // normalizeLevel floors garbage to 'internal' rather than 'public' — never treat an unrecognised
    // label as the least sensitive thing.
    levels.push(normalizeLevel(raw));
  }
  const sorted = [...new Set(levels)].sort((a, b) => levelRank(b) - levelRank(a));
  return { level: sorted[0] ?? null, unclassified, levels: sorted };
}

/** One sentence for a run header or an evidence pack row. */
export function describeSensitivity(s: RunSensitivity): string {
  if (!s.level && s.unclassified.length) {
    return `Read ${s.unclassified.length} source${s.unclassified.length === 1 ? '' : 's'} that nobody has classified`;
  }
  if (!s.level) return 'Read no classified source';
  const tail = s.unclassified.length
    ? ` · ${s.unclassified.length} source${s.unclassified.length === 1 ? '' : 's'} unclassified`
    : '';
  return `Read ${s.level} data${tail}`;
}

/** Does this run cross a reporting floor — the query a DPO actually runs. */
export function atOrAbove(s: RunSensitivity, floor: ClassificationLevel): boolean {
  return s.level !== null && levelRank(s.level) >= levelRank(floor);
}
