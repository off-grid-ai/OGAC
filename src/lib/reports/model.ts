// Structured report DOCUMENT model — the single source of truth for a submittable governance report
// (regulator pack, DPO evidence pack, CDO inventory, audit/quality summary). ZERO imports so the
// shape + its completeness rules are unit-testable without React, pdf, or a request.
//
// WHY structured (not a Markdown string): these documents are SUBMITTED to a regulator, a Data
// Protection Officer, or a Chief Data Officer. A markdown blob can't be validated for correctness or
// completeness and can't be laid out as a professional PDF. A typed model can: the renderer
// (reports/render.tsx) turns it into a branded PDF, and the validator (reports/validate.ts) proves it
// is complete before it ever ships.

/** Who the document is prepared for — drives the cover page "Prepared for" + confidentiality tone. */
export type Recipient =
  | { role: 'regulator'; name: string } // e.g. "IRDAI", "Reserve Bank of India"
  | { role: 'dpo'; name: string } // Data Protection Officer (DPDP)
  | { role: 'cdo'; name: string } // Chief Data Officer
  | { role: 'internal'; name: string }; // internal governance / board

export type Classification = 'Public' | 'Internal' | 'Confidential' | 'Restricted';

export interface ReportPeriod {
  from: string; // ISO date (inclusive)
  to: string; // ISO date (inclusive)
}

/** Detached-manifest provenance reference shown on the cover so the artifact is tamper-evident. */
export interface ReportProvenance {
  manifestId: string;
  sha256: string;
  signer: string; // the signing key / authority id
}

export interface ReportMeta {
  title: string; // e.g. "Regulator Response Pack"
  subtitle?: string; // e.g. the framework long name
  tenantName: string; // the org this is FOR (e.g. "Suraksha Life Insurance")
  framework?: string; // e.g. "IRDAI", "DPDP Act 2023", "ISO/IEC 42001"
  period: ReportPeriod;
  recipient: Recipient;
  classification: Classification;
  generatedAt: string; // ISO timestamp
  provenance?: ReportProvenance;
}

// ── Content blocks (a section is an ordered list of these) ──────────────────────────────────────────
export interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}
/** A callout/attestation band — a highlighted statement (regulatory status, attestation sentence). */
export interface CalloutBlock {
  type: 'callout';
  tone: 'info' | 'attest' | 'warn';
  text: string;
}
/** Label→value pairs (e.g. "Overall posture: 63%"). */
export interface KeyValuesBlock {
  type: 'keyValues';
  rows: { label: string; value: string }[];
}
/** A real data table with a header row. `total`, when set, is reconciled by the validator. */
export interface TableBlock {
  type: 'table';
  columns: string[];
  rows: string[][];
  /** Optional declared row count for completeness reconciliation (rows.length must equal it). */
  declaredCount?: number;
}
/** A control/status list: each item resolves to a status chip (pass/fail/partial/na). */
export type ControlStatus = 'pass' | 'fail' | 'partial' | 'na';
export interface StatusListBlock {
  type: 'statusList';
  items: { label: string; status: ControlStatus; note?: string }[];
}
/** Signature block for the accountable owner submitting the document. */
export interface SignatureBlock {
  type: 'signature';
  name: string;
  title: string;
}

export type ReportBlock =
  | ParagraphBlock
  | CalloutBlock
  | KeyValuesBlock
  | TableBlock
  | StatusListBlock
  | SignatureBlock;

export interface ReportSection {
  heading: string;
  blocks: ReportBlock[];
}

export interface ReportDoc {
  meta: ReportMeta;
  sections: ReportSection[];
  /** Stable download base name (no extension). */
  filenameBase: string;
}

// ── Pure helpers reused by generators + renderer (DRY) ───────────────────────────────────────────────

/** Human label for a recipient role — used on the cover "Prepared for" line. */
export function recipientLabel(r: Recipient): string {
  switch (r.role) {
    case 'regulator':
      return `${r.name} (Regulator)`;
    case 'dpo':
      return `${r.name}, Data Protection Officer`;
    case 'cdo':
      return `${r.name}, Chief Data Officer`;
    case 'internal':
      return r.name;
  }
}

/** Format an ISO date as "12 Jul 2026" (UTC, locale-stable) for the cover + period band. */
export function formatReportDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
