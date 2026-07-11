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
