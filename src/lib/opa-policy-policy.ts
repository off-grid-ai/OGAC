// Pure Rego-module logic — zero imports, unit-testable. This is the SOLID seam for the OPA
// policy-as-code surface: module-id derivation/validation, request/response shaping, and OPA
// compile-error parsing all live here with no network/DB. lib/opa-policy.ts is the thin I/O
// adapter that talks to the OPA policy API (PUT/GET/DELETE /v1/policies/{id}) using what this
// validates and parses.
//
// This surface is the ADVANCED, optional path: the first-party ABAC engine stays the default
// decision engine. Rego modules authored here are compiled + stored by OPA; they do not replace
// the console_policy data document the ABAC push produces.

// ─── Module id ──────────────────────────────────────────────────────────────

// An OPA policy id is a free-form string used as a path segment in /v1/policies/{id}. We constrain
// the console-authored ids to a safe slug so they round-trip through the URL and the OPA API without
// escaping surprises: lowercase alnum plus separators, no leading/trailing separator.
const ID_MAX = 128;
const ID_RE = /^[a-z0-9][a-z0-9._/-]{0,126}[a-z0-9]$|^[a-z0-9]$/;

export function isValidModuleId(id: string): boolean {
  return typeof id === 'string' && id.length <= ID_MAX && ID_RE.test(id);
}

// Derive a safe module id from a human title (used when creating a module without an explicit id).
// Lowercases, replaces runs of non-slug chars with '-', trims separators. Returns '' if nothing
// usable survives (the validator turns that into an error).
export function slugifyModuleId(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^[-._/]+|[-._/]+$/g, '')
    .slice(0, ID_MAX);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface RegoModuleInput {
  id: string;
  rego: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

const REGO_MAX = 200_000; // guard against pathological uploads

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// A minimal structural sanity check we can do WITHOUT compiling: a Rego module must declare a
// package. OPA itself is the authoritative compiler (it rejects everything else on upload); this
// only catches the obvious "you forgot the package header" locally so the round-trip is cheaper.
export function hasPackageDeclaration(rego: string): boolean {
  return /^\s*package\s+[a-zA-Z_][\w.[\]"]*\s*$/m.test(rego);
}

// Validate a create/update payload. Never throws — returns a result so routes stay thin. `id` is
// required (routes derive it from the title via slugifyModuleId when the client omits it).
export function validateRegoModule(raw: unknown): ValidationResult<RegoModuleInput> {
  const errors: string[] = [];
  const body = (raw ?? {}) as Record<string, unknown>;

  const id = asString(body.id).trim();
  if (!id) errors.push('id is required');
  else if (!isValidModuleId(id))
    errors.push('id must be a slug: lowercase letters, digits, and ._-/ (no leading/trailing sep)');

  const rego = asString(body.rego);
  if (!rego.trim()) errors.push('rego source is required');
  else if (rego.length > REGO_MAX) errors.push(`rego source must be ≤ ${REGO_MAX} chars`);
  else if (!hasPackageDeclaration(rego))
    errors.push('rego must declare a package (e.g. `package offgrid.authz`)');

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { id, rego } };
}

// ─── OPA compile-error parsing ─────────────────────────────────────────────────

// One compile diagnostic, flattened to a display-ready row. `location` is "row:col" when OPA gave
// coordinates, else ''.
export interface RegoCompileError {
  code: string;
  message: string;
  location: string;
}

// OPA's error body on an invalid PUT /v1/policies/{id} looks like:
//   { "code": "invalid_parameter",
//     "message": "error(s) occurred while compiling module(s)",
//     "errors": [ { "code": "rego_parse_error", "message": "...",
//                   "location": { "file": "id", "row": 3, "col": 5 } }, ... ] }
// Some errors arrive as just { code, message } with no nested `errors`. Parse both, never throw.
export function parseOpaCompileErrors(raw: unknown): RegoCompileError[] {
  if (raw === null || typeof raw !== 'object') return [];
  const body = raw as Record<string, unknown>;
  const nested = Array.isArray(body.errors) ? body.errors : null;
  if (nested?.length) {
    return nested.map((e) => flattenError(e)).filter((e): e is RegoCompileError => e !== null);
  }
  // No nested list — surface the top-level code/message as a single diagnostic.
  const code = asString(body.code);
  const message = asString(body.message);
  if (code || message)
    return [{ code: code || 'error', message: message || 'unknown error', location: '' }];
  return [];
}

function flattenError(e: unknown): RegoCompileError | null {
  if (e === null || typeof e !== 'object') return null;
  const obj = e as Record<string, unknown>;
  const code = asString(obj.code) || 'error';
  const message = asString(obj.message) || 'unknown error';
  let location = '';
  const loc = obj.location;
  if (loc !== null && typeof loc === 'object') {
    const l = loc as Record<string, unknown>;
    const row = typeof l.row === 'number' ? l.row : undefined;
    const col = typeof l.col === 'number' ? l.col : undefined;
    if (row !== undefined) location = col !== undefined ? `${row}:${col}` : String(row);
  }
  return { code, message, location };
}

// Join compile diagnostics into a single human line for a toast / error field.
export function formatCompileErrors(errors: RegoCompileError[]): string {
  if (!errors.length) return 'compile failed';
  return errors.map((e) => (e.location ? `${e.location} ${e.message}` : e.message)).join('; ');
}

// ─── Response shaping ───────────────────────────────────────────────────────────

// The console-facing shape of a stored module. OPA's GET returns { id, raw, ast }; we keep id + raw
// (the Rego source) and derive the package name for the list view.
export interface RegoModule {
  id: string;
  rego: string;
  package: string; // parsed from the source, '' if unparseable
}

export function packageOf(rego: string): string {
  const m = /^\s*package\s+([a-zA-Z_][\w.]*)/m.exec(rego ?? '');
  return m ? m[1] : '';
}

// Normalize one OPA policy record (from GET /v1/policies or /v1/policies/{id}) into a RegoModule.
// Accepts the loose { id, raw } shape; missing fields degrade to '' rather than throwing.
export function normalizeModule(raw: unknown): RegoModule | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id);
  if (!id) return null;
  const rego = asString(obj.raw);
  return { id, rego, package: packageOf(rego) };
}

// Normalize the GET /v1/policies list body ({ result: [...] }) into RegoModules, dropping any
// records without an id. Non-array / absent result → [].
export function normalizeModuleList(raw: unknown): RegoModule[] {
  if (raw === null || typeof raw !== 'object') return [];
  const result = (raw as Record<string, unknown>).result;
  if (!Array.isArray(result)) return [];
  return result
    .map((r) => normalizeModule(r))
    .filter((m): m is RegoModule => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Build the OPA policy-API url for a given id (or the collection). Trims a trailing slash from the
// base so join is clean. Encodes the id path segment.
export function opaPolicyUrl(base: string, id?: string): string {
  const root = `${base.replace(/\/$/, '')}/v1/policies`;
  return id ? `${root}/${encodeURIComponent(id)}` : root;
}

// A starter Rego module the editor pre-fills for a new authz policy — mirrors the offgrid/authz
// decision path the OPA decision adapter queries, so an operator sees a working shape immediately.
export const STARTER_REGO = `package offgrid.authz

import rego.v1

# Default deny — nothing is allowed unless a rule below says so.
default allow := false

# Example: allow admins.
allow if {
	input.role == "admin"
}
`;
