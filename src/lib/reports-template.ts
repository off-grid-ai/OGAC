// Pure policy/logic for report templates — zero imports, unit-testable in isolation (mirrors
// tenancy-policy.ts). Validation + normalization of operator-authored report templates. The DB
// adapter (reports.ts) and route handlers depend on this; this depends on nothing.

// The composable sections an operator can assemble a custom report from. Each maps to a live
// section renderer in reports.ts, so a template can never drift from the dashboards.
export const REPORT_SECTIONS = [
  'compliance',
  'frameworks',
  'controls',
  'governance',
  'audit',
  'inventory',
  'evals',
  'residency',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

// Frameworks a template can be mapped to (used to filter framework-coverage output).
export const REPORT_FRAMEWORKS = [
  'dpdp',
  'gdpr',
  'eu-ai-act',
  'iso-42001',
  'nist-ai-rmf',
] as const;

export const REPORT_SOURCES = [
  'Regulatory plane',
  'Analytics · audit store',
  'Brain · golden set',
  'Control & data planes',
  'Regulator pack',
] as const;

export const REPORT_SCHEDULES = ['none', 'daily', 'weekly', 'monthly', 'quarterly'] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];

export interface TemplateInput {
  name?: unknown;
  description?: unknown;
  sections?: unknown;
  frameworks?: unknown;
  source?: unknown;
  schedule?: unknown;
}

export interface NormalizedTemplate {
  name: string;
  description: string;
  sections: ReportSection[];
  frameworks: string[];
  source: string;
  schedule: ReportSchedule;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: NormalizedTemplate;
}

function cleanStringList(v: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (allowed.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

// Slugify a template name into a stable, url-safe id fragment.
export function slugifyTemplateName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

// Validate + normalize an operator-authored template. Pure: returns errors instead of throwing so
// route handlers can map to 400s and the UI can show them. `partial` skips required-field checks
// for PATCH (only the provided fields are validated/normalized against the merged record upstream).
export function validateTemplate(input: TemplateInput, partial = false): ValidationResult {
  const errors: string[] = [];

  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : '';
  if (!partial && !name) errors.push('name is required');
  if (typeof input.name === 'string' && input.name.trim().length > 200) {
    errors.push('name must be 200 characters or fewer');
  }

  const description =
    typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '';

  const sections = cleanStringList(input.sections, REPORT_SECTIONS) as ReportSection[];
  if (!partial && sections.length === 0) {
    errors.push('at least one valid section is required');
  }
  // Reject sections that were supplied but not recognized (surface typos rather than silently drop).
  if (Array.isArray(input.sections)) {
    for (const s of input.sections) {
      if (typeof s === 'string' && s.trim() && !REPORT_SECTIONS.includes(s.trim().toLowerCase() as ReportSection)) {
        errors.push(`unknown section: ${s}`);
      }
    }
  }

  const frameworks = cleanStringList(input.frameworks, REPORT_FRAMEWORKS);

  let source = typeof input.source === 'string' ? input.source.trim() : '';
  if (!source) source = 'Regulatory plane';
  if (!(REPORT_SOURCES as readonly string[]).includes(source)) {
    errors.push(`unknown source: ${source}`);
  }

  const rawSchedule = typeof input.schedule === 'string' ? input.schedule.trim().toLowerCase() : 'none';
  const schedule = (REPORT_SCHEDULES as readonly string[]).includes(rawSchedule)
    ? (rawSchedule as ReportSchedule)
    : 'none';

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: { name, description, sections, frameworks, source, schedule },
  };
}
