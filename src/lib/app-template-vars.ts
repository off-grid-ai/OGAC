// ─── Parameterized template-variable engine (SOP / template reuse) — PURE, zero-IO ─────────────────
// A reusable SOP is worthless if every adopting team must hand-edit prompts to fit their context. So
// a published template declares typed VARIABLES ({{var}} placeholders) with a schema (name, type,
// description, default, required); the adopting team fills them in once and this engine binds those
// values into the app's text fields. The rule that overrides everything (HONESTY): an unbound or
// missing required variable is surfaced as a truthful GAP — we NEVER ship a spec that still contains
// a raw {{placeholder}} pretending to be done.
//
// SOLID: this module owns the substitution + validation rule, isolated from I/O. The clone/instantiate
// flow (apps-store.ts) calls bindTemplateVars AFTER cloneAppSpec, before persisting. Run-time wiring
// into app-run.ts is a FOLLOW-UP round owned by another agent — this module is the pure engine only.
// See test/app-template-vars.test.ts.

import type { AppSpec, AppStep, FormField } from '@/lib/app-model';

// ─── The variable schema a template declares ───────────────────────────────────
export type TemplateVarType = 'text' | 'number' | 'boolean' | 'select';

export interface TemplateVar {
  /** The placeholder name — what appears between the braces: {{name}}. */
  name: string;
  type: TemplateVarType;
  /** Plain-language help shown on the "Use this template" form. */
  description?: string;
  /** Default value bound when the adopter leaves the field blank (string form). */
  default?: string;
  /** A required var with no default is a hard gap if the adopter doesn't supply it. */
  required?: boolean;
  /** Allowed values for type:'select'. */
  options?: string[];
}

// The full schema carried by a published template (the ordered list of its declared vars).
export interface TemplateVarSchema {
  vars: TemplateVar[];
}

// ─── PLACEHOLDER_RE — the {{var}} grammar ──────────────────────────────────────
// A placeholder is {{ name }} with optional surrounding whitespace; name is a word-ish token
// (letters, digits, underscore, dot, hyphen). We intentionally do NOT support expressions — this is
// a variable binding, not a template language, so the rule stays simple and honest.
const NAME_CHARS = 'A-Za-z0-9_.-';
const PLACEHOLDER_RE = new RegExp(`\\{\\{\\s*([${NAME_CHARS}]+)\\s*\\}\\}`, 'g');
/** A single, anchored variant for validating one declared var name. */
const VALID_NAME_RE = new RegExp(`^[${NAME_CHARS}]+$`);

/** Is `name` a legal placeholder token? (declaration-time validation) */
export function isValidVarName(name: string): boolean {
  return typeof name === 'string' && VALID_NAME_RE.test(name);
}

// ─── extractPlaceholders — every distinct {{var}} referenced in a string (PURE) ─
export function extractPlaceholders(text: string): string[] {
  if (typeof text !== 'string' || !text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  return [...found];
}

// ─── collectSpecPlaceholders — every {{var}} referenced anywhere in an AppSpec ──
// Walks the text-bearing fields of a spec (title, summary, agent system prompts, form labels,
// step labels, output/trigger config strings) so a template author can see what their spec
// actually parameterizes, and validation can flag placeholders the schema forgot to declare.
export function collectSpecPlaceholders(spec: AppSpec): string[] {
  const found = new Set<string>();
  const eat = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const name of extractPlaceholders(v)) found.add(name);
    } else if (Array.isArray(v)) {
      for (const item of v) eat(item);
    } else if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) eat(val);
    }
  };
  eat(spec.title);
  eat(spec.summary);
  eat(spec.inputForm);
  eat(spec.trigger?.config);
  for (const step of spec.steps ?? []) eat(step);
  return [...found];
}

// ─── substituteString — bind values into one string (PURE) ─────────────────────
// Replaces every {{name}} whose name is in `values`. A placeholder with no bound value is left
// UNTOUCHED (never blanked) so validation can detect it — silent blanking would hide the gap.
export function substituteString(text: string, values: Record<string, string>): string {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(PLACEHOLDER_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole,
  );
}

// ─── The validation outcome — honest gaps, never a silent partial ──────────────
export interface BindResult {
  spec: AppSpec;
  /** Required vars the adopter did not supply and that have no default — a HARD gap. */
  missingRequired: string[];
  /** Placeholders still present in the bound spec (declared-but-unbound or undeclared) — a gap. */
  unbound: string[];
  /** Placeholders used in the spec that the schema never declared — an author-side gap. */
  undeclared: string[];
  /** True only when nothing above is non-empty: every placeholder is bound, no required var missing. */
  ok: boolean;
}

// ─── resolveValues — merge adopter input over schema defaults (PURE) ────────────
// For each declared var: use the adopter's supplied value if present & non-blank, else the schema
// default. Returns the effective binding map plus the list of required vars left unsatisfied.
export function resolveValues(
  schema: TemplateVarSchema,
  provided: Record<string, string>,
): { values: Record<string, string>; missingRequired: string[] } {
  const values: Record<string, string> = {};
  const missingRequired: string[] = [];
  for (const v of schema.vars ?? []) {
    const raw = provided[v.name];
    const supplied = typeof raw === 'string' ? raw : raw == null ? undefined : String(raw);
    const effective =
      supplied != null && supplied.trim() !== ''
        ? supplied
        : v.default != null && v.default !== ''
          ? v.default
          : undefined;
    if (effective != null) {
      values[v.name] = effective;
    } else if (v.required) {
      missingRequired.push(v.name);
    }
  }
  return { values, missingRequired };
}

// ─── substituteSpec — bind values into every text field of a spec (PURE) ────────
// Deep-substitutes the placeholder-bearing fields. Returns a NEW spec (never mutates the source).
export function substituteSpec(spec: AppSpec, values: Record<string, string>): AppSpec {
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string') return substituteString(v, values);
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = sub(val);
      return out;
    }
    return v;
  };
  return {
    ...spec,
    title: substituteString(spec.title, values),
    summary: substituteString(spec.summary, values),
    trigger: spec.trigger
      ? { ...spec.trigger, config: sub(spec.trigger.config) as Record<string, unknown> | undefined }
      : spec.trigger,
    inputForm: spec.inputForm
      ? (spec.inputForm.map(sub) as FormField[])
      : spec.inputForm,
    steps: (spec.steps ?? []).map((step) => sub(step) as AppStep),
  };
}

// ─── bindTemplateVars — the whole rule: resolve → substitute → validate (PURE) ──
// The single entry point the instantiate flow calls. It resolves defaults, substitutes, then
// reports EVERY gap honestly: missing required vars, any placeholder still unbound after
// substitution, and any placeholder the schema never declared. `ok` is true only when the bound
// spec is fully instantiated with no gaps.
export function bindTemplateVars(
  spec: AppSpec,
  schema: TemplateVarSchema,
  provided: Record<string, string>,
): BindResult {
  const { values, missingRequired } = resolveValues(schema, provided);
  const bound = substituteSpec(spec, values);

  const declared = new Set((schema.vars ?? []).map((v) => v.name));
  const usedInSource = collectSpecPlaceholders(spec);
  const undeclared = usedInSource.filter((name) => !declared.has(name));
  const unbound = collectSpecPlaceholders(bound);

  const ok = missingRequired.length === 0 && unbound.length === 0 && undeclared.length === 0;
  return { spec: bound, missingRequired, unbound, undeclared, ok };
}

// ─── validateVarSchema — the declaration-time rule for a template's var schema ──
// A template author declares vars; this checks the declaration is coherent BEFORE it's published:
// legal names, no duplicates, select vars carry options, defaults of a select are one of its
// options, and (a real usability guard) every {{placeholder}} the spec actually uses is declared.
export function validateVarSchema(schema: TemplateVarSchema, spec?: AppSpec): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const v of schema.vars ?? []) {
    if (!isValidVarName(v.name)) {
      errors.push(`invalid variable name: '${v.name}'`);
      continue;
    }
    if (seen.has(v.name)) errors.push(`duplicate variable: '${v.name}'`);
    seen.add(v.name);
    if (!['text', 'number', 'boolean', 'select'].includes(v.type)) {
      errors.push(`variable '${v.name}': unknown type '${v.type}'`);
    }
    if (v.type === 'select') {
      if (!v.options || v.options.length === 0) {
        errors.push(`variable '${v.name}': select needs at least one option`);
      } else if (v.default != null && v.default !== '' && !v.options.includes(v.default)) {
        errors.push(`variable '${v.name}': default '${v.default}' is not one of its options`);
      }
    }
  }
  if (spec) {
    const declared = new Set((schema.vars ?? []).map((v) => v.name));
    for (const used of collectSpecPlaceholders(spec)) {
      if (!declared.has(used)) errors.push(`spec uses undeclared variable: '${used}'`);
    }
  }
  return errors;
}
