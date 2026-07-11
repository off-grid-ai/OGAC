# Reliability accept-list

Findings deliberately NOT rewritten, with justification. The orchestrator should
apply the SonarCloud "Accept" transition to each of these.

Format: `rule | file:line | justification`

## typescript:S7758 — charCodeAt → codePointAt (kept: not semantics-identical)

These are UTF-16-code-unit hash/compare loops that iterate `for (i=0; i<len; i++)`
and combine every code unit. Switching to `codePointAt(i)` changes the produced
value for any non-BMP (surrogate-pair) input AND double-processes the low surrogate
on the next `i++`, so it is NOT behavior-preserving. Left as-is.

- typescript:S7758 | src/lib/demo/prng.ts:14 | FNV-1a hash over arbitrary string, per-code-unit; codePointAt changes hash for non-BMP input.
- typescript:S7758 | src/lib/tour-demo-seed.ts:36 | FNV-1a (BigInt) hash, per-code-unit; same non-BMP divergence.
- typescript:S7758 | src/lib/guardrail-rules-runtime.ts:58 | FNV-1a hash, per-code-unit; non-BMP divergence.
- typescript:S7758 | src/lib/data-redaction.ts:59 | FNV-1a hash, per-code-unit; non-BMP divergence.
- typescript:S7758 | src/lib/device-token.ts:53 | Constant-time token compare, per-code-unit XOR; codePointAt would change values and break the fixed-length walk. Security-sensitive — do not alter.
- typescript:S7758 | src/lib/workspace-grid.ts:61 | djb2-style hash, per-code-unit; non-BMP divergence.
- typescript:S7758 | src/lib/adapters/inference.ts:14 | Bag-of-words feature hash, per-code-unit; non-BMP divergence.

## typescript:S6847 — non-interactive element with mouse/keyboard listener (kept)

- typescript:S6847 | src/components/ui/cards-carousel.tsx:165 | This is a proper `role="dialog" aria-modal="true"` modal. Its `onMouseDown` is click-outside-to-dismiss (guarded by `e.target === e.currentTarget`). The keyboard equivalent (Escape-to-close) is already wired via a `document` keydown effect in the same component, so keyboard users can close it. Adding a redundant element-level onKeyDown or converting the dialog container to a native control would either duplicate the handler or break the modal-dialog semantics — no accessibility gap to fix.
