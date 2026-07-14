// ─── app-inputs — PURE run-input rules (zero-IO, unit-testable) ────────────────────────────────────
// The one place that decides whether a set of posted run inputs satisfies an app's inputForm, plus
// the pure helpers to seed defaults and coerce raw string values into their typed shapes. BOTH the
// console Input form (client) and the run route (server) call validateInputValues so the rule lives
// once (DRY) — the client shows inline errors, the server 400s with the same field errors.
//
// SOLID: no imports of I/O, no React, no DB. It takes a FormField[] (the app's declared input schema)
// + a values map (raw, as collected from the form or the request body) and returns a decision. The
// form-field type is the only thing it depends on.

import type { FormField } from './app-model';

// ─── Contract ──────────────────────────────────────────────────────────────────────────────────────
// validateInputValues(fields, values) → { ok, errors }
//   errors is keyed by field.key; a key is present ONLY when that field is invalid. Rules, per field:
//     • required   → a non-empty value must be present (after trimming strings). Missing ⇒ error.
//     • number     → if a value is present, it must parse to a FINITE number. NaN/Infinity/'' non-empty
//                    garbage ⇒ error. An absent value on a non-required number is fine.
//     • select     → if a value is present, it must be one of the field's options. Not-in-options ⇒ error.
//     • date       → if a value is present, it must be a valid parseable date. Unparseable ⇒ error.
//     • text/textarea/file → no format rule beyond required.
//   A field NOT declared in `fields` is ignored (extra keys pass through untouched).

export interface InputValidationResult {
  ok: boolean;
  errors: Record<string, string>;
}

// Is a raw value "present" (worth format-checking / satisfies required)? Strings are trimmed;
// null/undefined are absent; numbers/booleans are present as-is.
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

// Callers only pass values that already passed isPresent() (so never null/undefined) — this
// stringifies numbers/booleans for the format checks.
function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

export function validateInputValues(
  fields: FormField[],
  values: Record<string, unknown>,
): InputValidationResult {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = values[field.key];
    const present = isPresent(raw);

    if (field.required && !present) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }
    // Non-required + absent ⇒ nothing more to check for this field.
    if (!present) continue;

    switch (field.type) {
      case 'number': {
        const n = Number(asString(raw));
        if (!Number.isFinite(n)) {
          errors[field.key] = `${field.label} must be a number`;
        }
        break;
      }
      case 'select': {
        const options = field.options ?? [];
        if (!options.includes(asString(raw))) {
          errors[field.key] = `${field.label} must be one of the offered options`;
        }
        break;
      }
      case 'date': {
        const t = Date.parse(asString(raw));
        if (Number.isNaN(t)) {
          errors[field.key] = `${field.label} must be a valid date`;
        }
        break;
      }
      default:
        // text / textarea / file — presence already satisfied above.
        break;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// ─── applyInputDefaults — seed a values map from each field's `default` ─────────────────────────────
// Used to INITIALIZE the form when it opens. A field's default is used ONLY when the incoming values
// map has no present value for that key (so a user-typed value never gets clobbered by a default).
// Returns a NEW map (pure); the input is not mutated. Fields with no default and no incoming value
// are left absent (not seeded with '').
export function applyInputDefaults(
  fields: FormField[],
  values: Record<string, unknown> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  // Carry over any incoming values first (as strings, the form's representation).
  for (const [k, v] of Object.entries(values)) {
    if (isPresent(v)) out[k] = asString(v);
  }
  for (const field of fields) {
    if (!isPresent(out[field.key]) && field.default !== undefined && field.default !== '') {
      out[field.key] = field.default;
    }
  }
  return out;
}

// ─── coerceInputValues — turn raw form strings into their typed values for submission ───────────────
// The form collects everything as strings; before a run the values should carry their real types:
//   • number → a finite JS number (invalid/absent numbers are DROPPED, not sent as NaN)
//   • everything else → the trimmed string (absent values dropped)
// Only declared fields are coerced; undeclared keys pass through unchanged (typed as-is). Pure —
// returns a new object.
export function coerceInputValues(
  fields: FormField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const field of fields) {
    const raw = out[field.key];
    if (!isPresent(raw)) {
      // Absent declared field: don't carry an empty placeholder into the run payload.
      delete out[field.key];
      continue;
    }
    if (field.type === 'number') {
      const n = Number(asString(raw));
      if (Number.isFinite(n)) out[field.key] = n;
      else delete out[field.key];
    } else if (typeof raw === 'string') {
      out[field.key] = raw.trim();
    }
  }
  return out;
}
