// ─── App run-input rules (Builder Epic — "one input box" fix) — PURE, zero-IO ─────────────────────
//
// The one place the run-input contract lives. An app declares an `inputForm` (FormField[]); before a
// run we (1) fill unset fields from their declared default, (2) validate required/typed constraints,
// and (3) coerce typed values (numbers → Number) for the executor. Both the client run form
// (AppInputForm) AND the server run route call these — one rule, one place (DRY). No imports, no I/O,
// so every branch is unit-testable in isolation.

import type { FormField } from './app-model';

export interface InputValidationResult {
  ok: boolean;
  /** Per-field error message, keyed by the field's `key`. Empty when ok. */
  errors: Record<string, string>;
}

// A value is "empty" for required-checking purposes when it is null/undefined or a blank/whitespace
// string. Numbers (incl. 0) and other primitives are NOT empty.
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

// ─── applyInputDefaults — fill any unset field from its declared `default` ─────────────────────────
// "Unset" = the key is absent or its value is empty (blank string / null / undefined). A field with
// no `default` and no value is left absent. Returns a fresh string-map (never mutates its inputs).
export function applyInputDefaults(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Carry over any provided non-empty values first (as strings — the form collects strings).
  for (const [k, v] of Object.entries(values)) {
    if (!isEmpty(v)) out[k] = String(v);
  }
  for (const f of fields) {
    if (isEmpty(out[f.key]) && f.default !== undefined && f.default !== '') {
      out[f.key] = f.default;
    }
  }
  return out;
}

// ─── validateInputValues — required + typed constraints, per-field messages ────────────────────────
// Rules, per field:
//   • required → must be present and non-empty
//   • number   → if present & non-empty, must parse as a finite number
//   • select   → if present & non-empty, must be one of `options`
//   • date     → if present & non-empty, must parse as a valid date
// A missing OPTIONAL field is fine (no type check runs on an absent value).
export function validateInputValues(
  fields: FormField[],
  values: Record<string, unknown>,
): InputValidationResult {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const value = values[f.key];
    const empty = isEmpty(value);

    if (f.required && empty) {
      errors[f.key] = `${f.label} is required`;
      continue; // no point type-checking an empty required field
    }
    if (empty) continue; // optional + empty → nothing to validate

    const str = String(value).trim();
    if (f.type === 'number') {
      if (!Number.isFinite(Number(str))) errors[f.key] = `${f.label} must be a number`;
    } else if (f.type === 'select') {
      const options = f.options ?? [];
      if (!options.includes(str)) errors[f.key] = `${f.label} must be one of the listed options`;
    } else if (f.type === 'date') {
      if (Number.isNaN(Date.parse(str))) errors[f.key] = `${f.label} must be a valid date`;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// ─── coerceInputValues — number fields → Number, everything else left as-is ────────────────────────
// Runs AFTER validation. Number fields with a non-empty value become a JS number; all other fields
// pass through unchanged (strings stay strings). Empty values are dropped so the executor sees only
// the fields that were actually provided.
export function coerceInputValues(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (isEmpty(v)) continue;
    const field = byKey.get(k);
    if (field?.type === 'number') {
      out[k] = Number(String(v).trim());
    } else {
      out[k] = v;
    }
  }
  return out;
}
