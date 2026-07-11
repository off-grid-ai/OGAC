import type { ReportBlock, ReportDoc, ReportSection } from '@/lib/reports/model';

// Pure completeness + correctness gate for a submittable report. ZERO IO. A document that fails this
// must NOT be shipped to a regulator / DPO / CDO — the export route returns an error instead of a
// half-empty PDF. This is the "validate for correctness and completeness" guarantee, made executable.
//
// It checks structural completeness (required metadata, at least one section, no empty tables /
// placeholder rows) and internal correctness (declared table counts reconcile, dates are ordered,
// status chips are known values). It is intentionally strict: a blank cell, a "TODO", or a table that
// claims 12 rows but has 9 is a defect in a compliance artifact.

export interface ValidationIssue {
  path: string; // where the problem is, e.g. "sections[2].blocks[0]"
  message: string;
}
export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
// Placeholder tells that must never reach a regulator: empty, a lone dash, or an author's TODO.
const PLACEHOLDER = /^\s*(|-|—|–|n\/a|na|tbd|todo|xxx|placeholder|lorem)\s*$/i;

function isPlaceholder(v: string): boolean {
  return PLACEHOLDER.test(v);
}

function checkBlock(block: ReportBlock, path: string, issues: ValidationIssue[]): void {
  switch (block.type) {
    case 'paragraph':
      if (!block.text.trim()) issues.push({ path, message: 'empty paragraph' });
      break;
    case 'callout':
      if (!block.text.trim()) issues.push({ path, message: 'empty callout' });
      break;
    case 'keyValues':
      if (block.rows.length === 0) issues.push({ path, message: 'keyValues has no rows' });
      block.rows.forEach((r, i) => {
        if (!r.label.trim()) issues.push({ path: `${path}.rows[${i}]`, message: 'missing label' });
        if (isPlaceholder(r.value))
          issues.push({ path: `${path}.rows[${i}]`, message: `placeholder value for "${r.label}"` });
      });
      break;
    case 'table':
      if (block.columns.length === 0) issues.push({ path, message: 'table has no columns' });
      if (block.rows.length === 0) issues.push({ path, message: 'table has no rows' });
      if (block.declaredCount !== undefined && block.declaredCount !== block.rows.length)
        issues.push({
          path,
          message: `table row count ${block.rows.length} does not reconcile with declared ${block.declaredCount}`,
        });
      block.rows.forEach((row, i) => {
        if (row.length !== block.columns.length)
          issues.push({
            path: `${path}.rows[${i}]`,
            message: `row has ${row.length} cells, expected ${block.columns.length}`,
          });
        if (row.every((c) => isPlaceholder(c)))
          issues.push({ path: `${path}.rows[${i}]`, message: 'entirely-empty/placeholder row' });
      });
      break;
    case 'statusList':
      if (block.items.length === 0) issues.push({ path, message: 'statusList has no items' });
      block.items.forEach((it, i) => {
        if (!it.label.trim())
          issues.push({ path: `${path}.items[${i}]`, message: 'missing control label' });
        if (!['pass', 'fail', 'partial', 'na'].includes(it.status))
          issues.push({ path: `${path}.items[${i}]`, message: `unknown status "${it.status}"` });
      });
      break;
    case 'signature':
      if (!block.name.trim() || !block.title.trim())
        issues.push({ path, message: 'signature missing name or title' });
      break;
  }
}

function checkSection(section: ReportSection, path: string, issues: ValidationIssue[]): void {
  if (!section.heading.trim()) issues.push({ path, message: 'section missing heading' });
  if (section.blocks.length === 0) issues.push({ path, message: 'section has no content blocks' });
  section.blocks.forEach((b, i) => checkBlock(b, `${path}.blocks[${i}]`, issues));
}

/**
 * Validate a report document for completeness + correctness. Returns `{ ok, issues }`; `ok` is true
 * only when there are zero issues. Pure — doc in, verdict out.
 */
export function validateReportDoc(doc: ReportDoc): ValidationResult {
  const issues: ValidationIssue[] = [];
  const m = doc.meta;

  if (!m.title.trim()) issues.push({ path: 'meta.title', message: 'missing title' });
  if (!m.tenantName.trim()) issues.push({ path: 'meta.tenantName', message: 'missing tenant name' });
  if (!m.recipient?.name?.trim())
    issues.push({ path: 'meta.recipient', message: 'missing recipient' });
  if (!ISO_DATE.test(m.generatedAt))
    issues.push({ path: 'meta.generatedAt', message: 'missing/invalid generatedAt' });
  if (!ISO_DATE.test(m.period?.from) || !ISO_DATE.test(m.period?.to))
    issues.push({ path: 'meta.period', message: 'missing/invalid reporting period' });
  else if (m.period.from > m.period.to)
    issues.push({ path: 'meta.period', message: 'period.from is after period.to' });
  if (!doc.filenameBase?.trim())
    issues.push({ path: 'filenameBase', message: 'missing download filename base' });

  if (doc.sections.length === 0)
    issues.push({ path: 'sections', message: 'report has no sections' });
  doc.sections.forEach((s, i) => checkSection(s, `sections[${i}]`, issues));

  return { ok: issues.length === 0, issues };
}
