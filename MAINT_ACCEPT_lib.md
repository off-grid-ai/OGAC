# Maintainability accept-list — src/lib slice

Rule | file:line | justification

## S3735 — void operator (all 5 accepted: deliberate)
S3735 | src/lib/chat-run-dispatch.ts:86 | `void e;` deliberately marks a caught error as intentionally-unused (fallback path); removing it reintroduces an unused-var lint error.
S3735 | src/lib/cloud-client.ts:35 | `void chat_template_kwargs;` marks a destructured-but-dropped local as used (cloud providers reject the key). Removing breaks no-unused-vars.
S3735 | src/lib/finops.ts:189 | `void DAY_MS;` keeps a reserved const from being flagged unused; intentional.
S3735 | src/lib/overview-synthesis.ts:278 | `void connectors;` reserved input kept for a future tile; suppresses unused-param.
S3735 | src/lib/provit-token.ts:30 | `void db.update(...)` is the explicit fire-and-forget marker for a floating promise (satisfies no-floating-promises); removing it changes lint semantics and risks an unhandled-rejection warning.

## S6551 — object default stringification in template literal (all accepted: NOT behavior-preserving)
S6551 | src/lib/**/* (all ~130 sites) | The fix (wrap in JSON.stringify/String/.message) CHANGES the emitted/logged string output. These are error messages, SQL/DDL fragments, telemetry payloads and demo-seed ids where the exact rendered text is load-bearing. Altering stringification is a behavior change, out of scope for a behavior-preserving mechanical pass. Deliberately left as-is (matches the reliability-pass stance on hash/compare loops).

## S7780 — String.raw for escaped backslashes (all 19 accepted: behavior-sensitive, not cleanly mechanical)
S7780 | src/lib/presidio-recognizers.ts:263,274,284,295 | PII detection regex strings (PAN/Aadhaar/IFSC/email). Rewriting to String.raw`` risks silently altering a security-sensitive pattern; not worth the risk for a cosmetic change.
S7780 | src/lib/suggest-expectations.ts:235,244 | Great-Expectations regex payload strings; same risk class.
S7780 | src/lib/tour-demo-seed.ts:408 | Aadhaar redaction pattern string; same risk class.
S7780 | src/lib/adapters/signing.ts:40 | `.replaceAll('\\n', '\n')` mixes an escaped and a real newline; String.raw applies to only one and would not simplify without changing meaning.
S7780 | src/lib/adapters/triggers/email-imap.ts:198,219,226 | IMAP wire-protocol strings (\Seen flag, quoted-string escaping, header regex); byte-exact output required.
S7780 | src/lib/config.ts:98 | Regex-escaping replace over dotenv keys; String.raw does not apply cleanly to the interpolated escaped `$&`.
S7780 | src/lib/exporters/prometheus.ts:29 | Prometheus label escaping (\\ , \" , \n); output must stay byte-exact.
S7780 | src/lib/retrieval/query.ts:131,132 | SQL LIKE escaping + ESCAPE clause; byte-exact required.
S7780 | src/lib/strip-control-tokens.ts:27,38 | Dynamically-built control-token strip regexes; security-sensitive, leave as-is.
S7780 | src/lib/warehouse-model.ts:110 | ClickHouse string-literal escaping (\\ , \'); byte-exact required.

## S7778 — Array#push() called multiple times (all ~93 accepted: low value / reorder risk)
S7778 | src/lib/compliance-activity.ts (l.push run), src/lib/reports.ts, src/lib/trust-report.ts, src/lib/litellm-config.ts, src/lib/adapters/sinks/report.ts, src/lib/qa/scoring.ts, src/lib/exporters/*, src/lib/etl-kestra-compile.ts, src/lib/compliance.ts, src/lib/data-rtbf.ts, src/lib/demo/opensearch-telemetry.ts, src/lib/eval-geval.ts, src/lib/retrieval/query.ts | These are markdown / report / config builders where push() calls are interleaved with loops and conditionals. Merging only the truly-consecutive runs into a single push(a, b, …) is a large, purely-cosmetic edit with real line-ordering risk in governance report output (the exact rendered document is load-bearing / snapshot-tested). Deferred as low-value for a behavior-preserving pass — the deliverable prioritized the higher-leverage rules (S3358, S6582, S7776, S6594, S7755).

## S4624 — nested template literals (all 55 accepted: fiddly, low value)
S4624 | src/lib/**/* (error-message/id/label builders, e.g. adapters/*, tour-demo-seed.ts hash ids, langfuse.ts, display-host.ts, chat-trace.ts, service-credentials-lib.ts, etc.) | The fix is extracting each inner `${…}` template to a local const. Many sites are concise-arrow returns (`() => `x_${hash12(`…`)}``) where extraction means expanding to a block body — a lot of churn for a cosmetic gain, with per-site risk of altering the rendered id/message string. Deferred in favor of the higher-leverage rules. A follow-up pass can take these one file at a time.

## S3776 — Cognitive Complexity (all 52 accepted: behavior-change risk in policy/tenancy/guardrail code)
S3776 | src/lib/adapters/drift.ts, app-access-policy.ts, app-run.ts, agent-loop.ts, agentrun.ts, brain.ts, canvas-graph.ts, chat-mentions.ts, connector-exec.ts, connector-policy.ts, copilot-context.ts, erasure.ts, etl-job.ts, etl-kestra-compile.ts, eval-runner.ts, gateway.ts, gateways-policy.ts, guardrail-rules-runtime.ts, pipeline-governance.ts, pipelines-policy.ts, policy-rules-policy.ts, presidio-recognizers.ts, provit-intelligence.ts, review-inbox.ts, suggest-*.ts, trust-report.ts, user-activity.ts, user-invites-policy.ts, and others | Per the task's rules of engagement, cognitive-complexity refactors are only done when provably behavior-identical and low-risk, else accept-listed — and these functions live in the governance/policy/tenancy/guardrail core where a mis-factored branch is a real defect. The safe helper-extractions that also lower complexity were applied opportunistically in the S3358 pass (status.ts ratePerformance/rollupStatus, drift.ts statusFromEvidently, drift-view shareFromCounts, gateways-policy gatewayDetailLabel, overview-synthesis tone helpers, email-sink/data-quality/guardrails-view helpers). The remaining S3776 hotspots need a dedicated, test-backed decomposition pass — not a mechanical one — so they are accept-listed here rather than risked.

## S6582 / S7755 residual note
All S6582 (optional chaining) and S7755 (Array#at) sites in src/lib were FIXED; none accepted.
