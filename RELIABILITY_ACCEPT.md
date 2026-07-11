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

## typescript:S8786 — 'super-linear regex' (all kept: none exhibit catastrophic backtracking)

SonarCloud's S8786 is a heuristic that over-reports linear `+`/`*`/`{n,}` quantifiers. Each
regex below was read against its input source. None contain the overlapping/nested unbounded
quantifier shape (`(a+)+`, `(.*)*`, adjacent unbounded quantifiers over a shared class) that
produces exponential/polynomial ReDoS. Rewriting is not behavior-safe (JS has no possessive
quantifiers, and any structural change risks altering match/validation semantics on auth, SQL-
guard, or email paths), so per the rules of engagement these are accept-listed rather than
guessed at.

- typescript:S8786 | src/app/api/v1/admin/compose/route.ts:42 | brace-extract `\{[\s\S]*\}`: a single greedy `*` between literal braces — no overlapping quantifiers, linear. Parses a single LLM JSON reply once.
- typescript:S8786 | src/app/api/v1/admin/triggers/webhooks/route.ts:15 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/app/api/v1/studio/suggest/route.ts:54 | brace-extract `\{[\s\S]*\}`: a single greedy `*` between literal braces — no overlapping quantifiers, linear. Parses a single LLM JSON reply once.
- typescript:S8786 | src/app/api/waitlist/route.ts:8 | email shape `^[^\s@]+@[^\s@]+\.[^\s@]+$`: the `@`/`.` separators are excluded from the surrounding classes, so the `+` groups cannot overlap — linear. Validates a single short email string.
- typescript:S8786 | src/lib/adapters/sinks/email-smtp.ts:82 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/adapters/sinks/email-smtp.ts:316 | HTML/angle-bracket strip `<[^>]+>`: negated char-class `+`, no overlap, linear.
- typescript:S8786 | src/lib/adapters/tool-primitives.ts:230 | HTML/angle-bracket strip `<[^>]+>`: negated char-class `+`, no overlap, linear.
- typescript:S8786 | src/lib/app-compile.ts:359 | title-prefix strip `^[^—:\n]{3,60}?...`: lazy quantifier is bounded to 60 → worst case O(60·n), linear. Input is a short app description.
- typescript:S8786 | src/lib/app-compile.ts:364 | step splitter: an alternation of literal keywords/anchors, each a fixed token — no unbounded overlapping quantifier, linear. Input is a short app description.
- typescript:S8786 | src/lib/app-compile.ts:509 | brace-extract `\{[\s\S]*\}`: a single greedy `*` between literal braces — no overlapping quantifiers, linear. Parses a single LLM JSON reply once.
- typescript:S8786 | src/lib/apps-store.ts:282 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/artifacts.ts:13 | line-anchored (`gm`) export-keyword rewrite: fixed alternation, no unbounded overlap — linear.
- typescript:S8786 | src/lib/artifacts.ts:73 | line-anchored (`gm`) import strip with a single lazy `.*?` per line — bounded per line, linear. Runs over an artifact once.
- typescript:S8786 | src/lib/artifacts.ts:76 | line-anchored (`gm`) export-keyword rewrite: fixed alternation, no unbounded overlap — linear.
- typescript:S8786 | src/lib/artifacts.ts:85 | artifact heading extract: fixed/optional prefixes then a length-bounded `[^\n]{2,60}` — linear.
- typescript:S8786 | src/lib/artifacts.ts:144 | fenced-code extract with a single lazy `([\s\S]*?)` between literal fences — no nested/overlapping quantifier, linear. Runs once over a model reply.
- typescript:S8786 | src/lib/artifacts.ts:150 | fenced-code extract with a single lazy `([\s\S]*?)` between literal fences — no nested/overlapping quantifier, linear. Runs once over a model reply.
- typescript:S8786 | src/lib/artifacts.ts:154 | fenced-code extract with a single lazy `([\s\S]*?)` between literal fences — no nested/overlapping quantifier, linear. Runs once over a model reply.
- typescript:S8786 | src/lib/artifacts.ts:166 | fenced-code extract with a single lazy `([\s\S]*?)` between literal fences — no nested/overlapping quantifier, linear. Runs once over a model reply.
- typescript:S8786 | src/lib/chat-attach.ts:43 | trailing-space-before-newline collapse `[ \t]+\n` / `\n{3,}`: single anchored char-class quantifiers — linear whitespace normalization.
- typescript:S8786 | src/lib/chat-audio.ts:225 | markdown link/image strip `!?\[([^\]]*)\]\([^)]*\)`: negated-class `*` groups delimited by required literals `]`/`)` — no overlap, linear. Runs over TTS text.
- typescript:S8786 | src/lib/cloud-providers.ts:116 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/docs/index.ts:74 | markdown heading `^(##|###)\s+(.*)$`: literal alternation + single `.*` to EOL — linear. Parses our own docs, line by line.
- typescript:S8786 | src/lib/edge-intent.ts:41 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/eval-geval.ts:85 | `SCORE\s*[:=]?\s*([1-5])...`: only fixed/optional quantifiers over disjoint classes — linear. Parses a bounded LLM judge reply.
- typescript:S8786 | src/lib/exporters/openlineage.ts:32 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/exporters/prometheus.ts:132 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/exporters/splunk-hec.ts:22 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/gateway-api-key.ts:93 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/gateways-policy.ts:196 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/gateways-policy.ts:262 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/inbound-email.ts:85 | HTML/angle-bracket strip `<[^>]+>`: negated char-class `+`, no overlap, linear.
- typescript:S8786 | src/lib/inbound-email.ts:169 | HTML/angle-bracket strip `<[^>]+>`: negated char-class `+`, no overlap, linear.
- typescript:S8786 | src/lib/opa-policy-policy.ts:30 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/opa-policy-policy.ts:57 | Rego package matcher `^\s*package\s+[a-zA-Z_][\w...]*`: disjoint anchored classes, single `*` — linear. SECURITY-adjacent policy parse; not altered.
- typescript:S8786 | src/lib/opa-policy-policy.ts:145 | Rego package matcher `^\s*package\s+[a-zA-Z_][\w...]*`: disjoint anchored classes, single `*` — linear. SECURITY-adjacent policy parse; not altered.
- typescript:S8786 | src/lib/prompt-partials.ts:46 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/provit.ts:11 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/reports-template.ts:83 | affix trim (anchored single-char-class `+`): provably linear, no catastrophic backtracking. Slug/prefix normalization over bounded input.
- typescript:S8786 | src/lib/retrieval-view.ts:268 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/retrieval-writer.ts:35 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/secrets-ops.ts:194 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/secrets-ops.ts:207 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/service-credentials-lib.ts:139 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/service-credentials-lib.ts:144 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/service-specs.ts:46 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/strip-control-tokens.ts:59 | trailing-space-before-newline collapse `[ \t]+\n` / `\n{3,}`: single anchored char-class quantifiers — linear whitespace normalization.
- typescript:S8786 | src/lib/studio-builder.ts:118 | trailing-punctuation trim (anchored single-char-class `+`): linear. Input is a short generated label.
- typescript:S8786 | src/lib/trigger-dispatch.ts:272 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/trigger-dispatch.ts:315 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/user-invites-policy.ts:66 | email shape `^[^\s@]+@[^\s@]+\.[^\s@]+$`: the `@`/`.` separators are excluded from the surrounding classes, so the `+` groups cannot overlap — linear. Validates a single short email string.
- typescript:S8786 | src/lib/user-invites-policy.ts:219 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/user-invites-policy.ts:237 | trailing-slash trim `/\/+$/`: one anchored char-class `+`, provably linear (no overlapping quantifier). Input is a config/env base URL — bounded, trusted.
- typescript:S8786 | src/lib/warehouse-model.ts:195 | SQL identifier-before-paren guard `([A-Za-z_][A-Za-z0-9_]*)\s*\(`: the id class and `\s*` share no characters, `\(` is distinct — linear. SECURITY check; must not be altered.
