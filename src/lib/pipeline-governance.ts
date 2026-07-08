// ─── PURE pipeline-GOVERNANCE display + shaping layer — ZERO imports of db/IO ──────────────────────
//
// This is the presentation/derivation layer that sits ON TOP of the pure merge rule in
// pipelines-policy.ts (effectiveGovernance / PERMISSION_SCALE / GovernanceControl). It answers the
// questions the Policy + Guardrails tabs ask, without ever touching the DB or the network:
//
//   1. ORG_POLICY_DEFAULTS / ORG_GUARDRAIL_DEFAULTS — the canonical ORG baseline governance controls
//      the pipeline overlays inherit from. There is no org-governance store yet (see the plan's
//      "Hardened model": WE configure on the customer's behalf + ship sensible defaults), so these
//      seeded defaults ARE the org substrate. Some controls are `locked` (mandatory — a pipeline may
//      only TIGHTEN) and some are `default` (freely overridable). Split policy vs guardrail so the two
//      tabs each own their slice while sharing one merge rule.
//   2. GOVERNANCE_CONTROL_META — the human labels / descriptions / value-vocabulary each control uses,
//      so the UI never hard-codes strings. Non-technical-operator language (the builder north star).
//   3. describeEffective(orgDefaults, overlay) — run effectiveGovernance, then decorate every control
//      with a DISPLAY SOURCE (org-locked | org-default | pipeline-override) + a human value string +
//      the loosen-rejected flag, so a tab can render each row honestly with where its value came from.
//   4. normalizeOverlay(unknown) — coerce a stored jsonb overlay (Record<string,unknown>) into a clean
//      GovernanceControls the merge accepts (drops junk, keeps only known controls for the slice).
//   5. tightenOverlay(orgDefaults, overlay, key, value) — produce the NEXT overlay after an operator
//      edits one control, PRE-VALIDATED against the org defaults: a loosen attempt is refused (returns
//      { ok:false, reason }) rather than silently persisted-then-rejected. A tighten (or a `default`
//      override) returns { ok:true, overlay } ready to hand to updatePipeline.
//   6. guardrailEntityToControl — turn a library selection (a guardrail catalog item's entity) into
//      the overlay control it sets, so "attach from the library" writes through THIS overlay (scoped
//      to the pipeline), tightening only — not the org store.
//
// Everything here is total + deterministic → unit-tested in test/pipeline-governance.test.ts.

import {
  type EffectiveControl,
  type EffectiveGovernance,
  type GovernanceControl,
  type GovernanceControls,
  type PermissionLevel,
  PERMISSION_SCALE,
  effectiveGovernance,
  isPermissionLevel,
} from '@/lib/pipelines-policy';

// ─── 1. the canonical ORG baseline governance controls ────────────────────────────────────────────
// These are the org substrate the pipeline overlays inherit. `locked` ⇒ a pipeline may only tighten.
// Values are either a boolean toggle (`bool`, true = the stricter/on state) or a PERMISSION_SCALE
// level (`level`, least→most permissive: block < mask < local < cloud < allow).

/** POLICY-tab org defaults — ABAC / egress / model-governance controls. */
export const ORG_POLICY_DEFAULTS: GovernanceControls = {
  // Egress ceiling — how far a request's data may travel. Locked at 'local' (on-prem): a pipeline may
  // tighten to 'mask'/'block' but can NEVER loosen to 'cloud'/'allow'. The core data-residency lock.
  maxEgress: { mode: 'locked', level: 'local' },
  // Whether an export/download action is permitted at all. Org default off; a pipeline may leave it.
  allowExport: { mode: 'default', bool: false },
  // Require a stated purpose on every invocation (purpose limitation). Locked on.
  requirePurpose: { mode: 'locked', bool: true },
  // Human-in-the-loop review before a generated action is committed. Freely overridable per pipeline.
  requireHumanReview: { mode: 'default', bool: false },
};

/** GUARDRAILS-tab org defaults — PII / injection / grounding / toxicity controls. */
export const ORG_GUARDRAIL_DEFAULTS: GovernanceControls = {
  // PII masking on retrieved data before it reaches the model. Locked on — a pipeline can't turn it off.
  requirePiiMasking: { mode: 'locked', bool: true },
  // Prompt-injection defence on inbound prompts. Locked on.
  blockPromptInjection: { mode: 'locked', bool: true },
  // Grounding / hallucination check on outputs. Org default off; a pipeline may enable it.
  requireGrounding: { mode: 'default', bool: false },
  // Toxicity / unsafe-content filter on outputs. Org default off; a pipeline may enable it.
  filterToxicity: { mode: 'default', bool: false },
};

// ─── 2. control metadata (labels / descriptions / value vocabulary) ────────────────────────────────

export type ControlValueKind = 'bool' | 'level';

export interface ControlMeta {
  key: string;
  label: string;
  /** Plain-language "what this enforces" for a non-technical operator. */
  description: string;
  kind: ControlValueKind;
  /** For a bool control: the label shown when true / false. */
  onLabel?: string;
  offLabel?: string;
}

export const GOVERNANCE_CONTROL_META: Record<string, ControlMeta> = {
  maxEgress: {
    key: 'maxEgress',
    label: 'Data egress ceiling',
    description:
      'How far a request’s data may travel. Tighter = stays closer to the box. You may only tighten the org ceiling, never loosen it.',
    kind: 'level',
  },
  allowExport: {
    key: 'allowExport',
    label: 'Allow export / download',
    description: 'Whether results from this pipeline may be exported or downloaded.',
    kind: 'bool',
    onLabel: 'Export allowed',
    offLabel: 'Export blocked',
  },
  requirePurpose: {
    key: 'requirePurpose',
    label: 'Require a stated purpose',
    description: 'Every call must declare why the data is being used (purpose limitation).',
    kind: 'bool',
    onLabel: 'Purpose required',
    offLabel: 'Not required',
  },
  requireHumanReview: {
    key: 'requireHumanReview',
    label: 'Require human review',
    description: 'A person must approve a generated action before it is committed.',
    kind: 'bool',
    onLabel: 'Review required',
    offLabel: 'No review',
  },
  requirePiiMasking: {
    key: 'requirePiiMasking',
    label: 'Mask PII before the model',
    description: 'Personal data in retrieved rows is masked before it reaches the model.',
    kind: 'bool',
    onLabel: 'Masking on',
    offLabel: 'Masking off',
  },
  blockPromptInjection: {
    key: 'blockPromptInjection',
    label: 'Block prompt injection',
    description: 'Inbound prompts are screened for injection / jailbreak attempts.',
    kind: 'bool',
    onLabel: 'Defence on',
    offLabel: 'Defence off',
  },
  requireGrounding: {
    key: 'requireGrounding',
    label: 'Require grounding',
    description: 'Outputs are checked against the retrieved context to catch hallucinations.',
    kind: 'bool',
    onLabel: 'Grounding on',
    offLabel: 'Grounding off',
  },
  filterToxicity: {
    key: 'filterToxicity',
    label: 'Filter toxic content',
    description: 'Outputs are screened for toxic / unsafe language.',
    kind: 'bool',
    onLabel: 'Filter on',
    offLabel: 'Filter off',
  },
};

/** Metadata for a control key; a safe generic fallback for an unknown key (never throws). PURE. */
export function controlMeta(key: string): ControlMeta {
  return (
    GOVERNANCE_CONTROL_META[key] ?? {
      key,
      label: key,
      description: '',
      kind: 'bool',
    }
  );
}

// ─── 3. describeEffective — the display model the tabs render ───────────────────────────────────────

/** Where a control's effective value came from — the honest source badge. */
export type ControlSource = 'org-locked' | 'org-default' | 'pipeline-override';

export interface EffectiveControlView {
  key: string;
  label: string;
  description: string;
  kind: ControlValueKind;
  /** The effective value after the merge, as a display string (e.g. 'local', 'Masking on'). */
  valueLabel: string;
  /** The raw effective values, so the editor can pre-fill its control. */
  bool?: boolean;
  level?: PermissionLevel;
  /** The org's own value label — shown as "org: <x>" when the pipeline overrode it. */
  orgValueLabel: string;
  source: ControlSource;
  /** True when the org control is locked (mandatory, tighten-only). */
  locked: boolean;
  /** True when this pipeline legitimately tightened / overrode the org value. */
  overridden: boolean;
  /** True when the overlay tried to LOOSEN a locked control and was refused — surface this. */
  loosenRejected: boolean;
}

export interface EffectiveGovernanceView {
  controls: EffectiveControlView[];
  /** Keys where a loosen attempt was rejected (the "you can't weaken this" signal). */
  rejected: string[];
}

/** Render one control's value (effective or org) as a human string. PURE. */
function valueLabelFor(meta: ControlMeta, ctrl: { bool?: boolean; level?: PermissionLevel }): string {
  if (meta.kind === 'level') return ctrl.level ?? '—';
  if (ctrl.bool === undefined) return '—';
  return ctrl.bool ? (meta.onLabel ?? 'On') : (meta.offLabel ?? 'Off');
}

/** The source badge for a merged control. PURE. */
export function sourceOf(eff: EffectiveControl): ControlSource {
  if (eff.overridden) return 'pipeline-override';
  return eff.fromLocked ? 'org-locked' : 'org-default';
}

/**
 * Merge org defaults with a pipeline overlay and decorate each control for display. PURE — wraps the
 * canonical effectiveGovernance() (no second merge rule) then attaches labels + the source badge +
 * the org value so the tab can show "pipeline-override (org: local)". Controls render in the org's
 * declared order (Object.entries of orgDefaults).
 */
export function describeEffective(
  orgDefaults: GovernanceControls,
  overlay: GovernanceControls,
): EffectiveGovernanceView {
  const merged: EffectiveGovernance = effectiveGovernance(orgDefaults, overlay);
  const controls: EffectiveControlView[] = [];

  for (const [key, org] of Object.entries(orgDefaults)) {
    const eff = merged.controls[key];
    if (!eff) continue;
    const meta = controlMeta(key);
    controls.push({
      key,
      label: meta.label,
      description: meta.description,
      kind: meta.kind,
      valueLabel: valueLabelFor(meta, eff),
      bool: eff.bool,
      level: eff.level,
      orgValueLabel: valueLabelFor(meta, org),
      source: sourceOf(eff),
      locked: eff.fromLocked,
      overridden: eff.overridden,
      loosenRejected: eff.loosenRejected,
    });
  }

  return { controls, rejected: merged.rejected };
}

// ─── 4. normalizeOverlay — coerce stored jsonb → clean GovernanceControls ──────────────────────────

/** Coerce one unknown value into a GovernanceControl, or null if it's junk. PURE. */
function coerceControl(v: unknown): GovernanceControl | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const mode = o.mode === 'locked' ? 'locked' : 'default';
  const out: GovernanceControl = { mode };
  if (typeof o.bool === 'boolean') out.bool = o.bool;
  if (isPermissionLevel(o.level)) out.level = o.level;
  // A control with neither a bool nor a level carries no information — drop it.
  if (out.bool === undefined && out.level === undefined) return null;
  return out;
}

/**
 * Coerce a stored overlay (jsonb Record<string,unknown>) into a clean GovernanceControls, keeping ONLY
 * keys that name a control in `known` (a pipeline can't invent controls the org didn't define). PURE.
 * The overlay stores controls as `default` mode (a pipeline overlay never declares its OWN lock — the
 * lock lives on the org control).
 */
export function normalizeOverlay(raw: unknown, known: GovernanceControls): GovernanceControls {
  const out: GovernanceControls = {};
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!(key in known)) continue;
    const ctrl = coerceControl(o[key]);
    if (ctrl) out[key] = ctrl;
  }
  return out;
}

// ─── 5. tightenOverlay — the pre-validated edit path ────────────────────────────────────────────────

export type OverlayEditResult =
  | { ok: true; overlay: GovernanceControls }
  | { ok: false; reason: string };

/** A proposed value for one control — a bool toggle OR a permission level. */
export interface ControlValue {
  bool?: boolean;
  level?: PermissionLevel;
}

function levelRank(level: PermissionLevel | undefined): number {
  if (level === undefined) return -1;
  return (PERMISSION_SCALE as readonly string[]).indexOf(level);
}

/**
 * Apply an operator's edit of ONE control to the overlay, PRE-VALIDATED against the org defaults, so a
 * loosen attempt on a locked control is refused up-front (never silently persisted-then-rejected).
 * PURE. Rules (mirroring effectiveGovernance so the two never disagree):
 *  - Unknown control key → refused (the org owns the control surface).
 *  - `default` org control → any valid value is accepted (freely overridable).
 *  - `locked` bool → may set to the stricter/on state; turning a locked-on control OFF is refused.
 *  - `locked` level → may set any level ≤ the org level (tighter); a more-permissive level is refused.
 * A value equal to the org value is stored as an explicit override too (harmless, keeps intent visible).
 * Returns the FULL next overlay so the caller hands it straight to updatePipeline.
 */
export function tightenOverlay(
  orgDefaults: GovernanceControls,
  overlay: GovernanceControls,
  key: string,
  value: ControlValue,
): OverlayEditResult {
  const org = orgDefaults[key];
  if (!org) return { ok: false, reason: `Unknown control "${key}" — the org has not defined it.` };
  const meta = controlMeta(key);

  const next: GovernanceControl = { mode: 'default' };

  if (meta.kind === 'bool') {
    if (typeof value.bool !== 'boolean') {
      return { ok: false, reason: `"${meta.label}" expects an on/off value.` };
    }
    if (org.mode === 'locked' && org.bool === true && value.bool === false) {
      return {
        ok: false,
        reason: `"${meta.label}" is locked on by the org — you can only keep it on, not turn it off.`,
      };
    }
    next.bool = value.bool;
  } else {
    if (!isPermissionLevel(value.level)) {
      return {
        ok: false,
        reason: `"${meta.label}" expects one of: ${PERMISSION_SCALE.join(', ')}.`,
      };
    }
    if (org.mode === 'locked' && org.level !== undefined) {
      if (levelRank(value.level) > levelRank(org.level)) {
        return {
          ok: false,
          reason: `"${meta.label}" is locked at "${org.level}" by the org — you can only tighten it (${PERMISSION_SCALE.slice(
            0,
            levelRank(org.level) + 1,
          ).join(', ')}), never loosen it.`,
        };
      }
    }
    next.level = value.level;
  }

  return { ok: true, overlay: { ...overlay, [key]: next } };
}

/** Remove one control from the overlay (revert to inheriting the org default). PURE. */
export function clearOverlayControl(overlay: GovernanceControls, key: string): GovernanceControls {
  const out = { ...overlay };
  delete out[key];
  return out;
}

// ─── 6. attach-from-library → overlay control ──────────────────────────────────────────────────────

/**
 * Turn a guardrail catalog choice into the overlay control it toggles ON for THIS pipeline. A catalog
 * entity maps to one of the guardrail controls; a behavioural validator maps to its matching toggle,
 * and any Presidio PII entity maps to "mask PII". PURE — returns { key, value } (always tightening on).
 * This keeps "attach a guardrail to a pipeline" writing through the pipeline's guardrailOverlay.
 */
export function guardrailEntityToControl(entity: string): { key: string; value: ControlValue } {
  switch (entity) {
    case 'PROMPT_INJECTION':
      return { key: 'blockPromptInjection', value: { bool: true } };
    case 'TOXIC_LANGUAGE':
    case 'PROFANITY':
      return { key: 'filterToxicity', value: { bool: true } };
    case 'GROUNDED':
    case 'GROUNDEDNESS':
    case 'PROVENANCE':
      return { key: 'requireGrounding', value: { bool: true } };
    default:
      // Any Presidio PII entity (EMAIL_ADDRESS, PAN, …) tightens "mask PII" on.
      return { key: 'requirePiiMasking', value: { bool: true } };
  }
}

/**
 * Enable a guardrail-catalog item on ONE pipeline: map its entity → the control it tightens, then
 * produce the NEXT guardrailOverlay from the pipeline's current (raw) overlay — pre-validated against
 * the org guardrail defaults (a loosen is refused up-front). PURE: composes normalizeOverlay +
 * guardrailEntityToControl + tightenOverlay so the scope-picker client only has to PATCH the result.
 * Returns the control key alongside so the caller can report / audit which control it turned on.
 */
export function enableGuardrailOnPipeline(
  rawOverlay: unknown,
  entity: string,
): OverlayEditResult & { key: string } {
  const overlay = normalizeOverlay(rawOverlay, ORG_GUARDRAIL_DEFAULTS);
  const { key, value } = guardrailEntityToControl(entity);
  const result = tightenOverlay(ORG_GUARDRAIL_DEFAULTS, overlay, key, value);
  return { ...result, key };
}

/**
 * Of the given pipelines, which have the guardrail-control that `entity` maps to turned ON in their
 * EFFECTIVE guardrails (org baseline tightened by their overlay)? Used by the catalog scope badge to
 * show "on for N pipelines" honestly. PURE — no I/O. Returns the matching pipelines' {id,name}.
 */
export function pipelinesEnforcingGuardrail(
  entity: string,
  pipelines: readonly { id: string; name: string; guardrailOverlay?: unknown }[],
): { id: string; name: string }[] {
  const { key } = guardrailEntityToControl(entity);
  return pipelines
    .filter((p) => {
      const overlay = normalizeOverlay(p.guardrailOverlay, ORG_GUARDRAIL_DEFAULTS);
      const view = describeEffective(ORG_GUARDRAIL_DEFAULTS, overlay);
      return view.controls.some((c) => c.key === key && c.bool === true);
    })
    .map((p) => ({ id: p.id, name: p.name }));
}
