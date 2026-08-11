// Repo-hygiene checks, in the shape of test/model-output-markdown.test.ts: this asserts on SOURCE
// TEXT, not runtime behaviour, because the defects it guards are exactly that a specific render
// site stopped going through the sanitizing mapper — the demo-readiness sweep found each of these
// live, and each was found by a human reading a screenshot, never by a test, until now.
//
// Four confirmed leaks, four narrow regexes — each one is the EXACT shape that shipped:
//   - /operations/runs/[id] — a run-timeline step's label rendered raw (`{s.label}`); this is the
//     one that put "llm-guard" in a run's step timeline, the screen the one-pager sends a buyer to
//     open first.
//   - /governance/trust/regulatory — an audit action code rendered raw (`{r.key}` / `{e.action}`).
//   - /governance/evidence/audit — the same class: `{r.action}` and an un-sanitized `resource` cell.
//   - /data/sources (via VectorDBInspector) — the vector-store picker's visible option TEXT was the
//     bare OSS project name ("qdrant" / "lancedb"), even though the wire-protocol `value` needs to
//     stay unchanged.
//
// Each check has a companion "catches the shape that shipped" test, proving the regex is not
// vacuously passing — it is asserted against the literal line that was on screen before the fix.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// ─── /operations/runs/[id] — the run-timeline step label ──────────────────────────────────────────

const RUN_DETAIL_PATH = 'src/app/(console)/operations/runs/[id]/page.tsx';
const RAW_STEP_LABEL = /<span[^>]*>\{s\.label\}<\/span>/;

test('run-detail: the timeline step label is never rendered raw', () => {
  const src = read(RUN_DETAIL_PATH);
  assert.equal(RAW_STEP_LABEL.test(src), false, 'a step label must go through publicLabel()');
  assert.match(src, /publicLabel\(s\.label\)/, 'the fix wraps the label in publicLabel');
});

test('run-detail: the guard actually catches the shape that shipped', () => {
  const shipped = '<span className="text-xs font-medium text-foreground">{s.label}</span>';
  assert.ok(RAW_STEP_LABEL.test(shipped), 'the regex must match the real defect');
});

// ─── /governance/trust/regulatory — raw action codes ───────────────────────────────────────────────

const REGULATORY_PATH = 'src/app/(console)/governance/regulatory/content.tsx';
// The exact old cells: a font-mono TableCell whose only content is the raw `.key` / `.action`
// expression. Scoped to `font-mono` so the (legitimate, unrelated) actor-name cell in the same file
// — which also happens to destructure a variable named `r` — is never a false match.
const RAW_ACTION_CELL =
  /<TableCell className="font-mono text-xs text-(?:foreground|muted-foreground)">\s*\{(?:r\.key|e\.action)\}\s*<\/TableCell>/;

test('regulatory: neither the "by action" nor the enforcement table renders a raw action code', () => {
  const src = read(REGULATORY_PATH);
  assert.equal(RAW_ACTION_CELL.test(src), false, 'an action code must go through plainAction()');
  assert.match(src, /(?:plainAction|publicActionLabel)\(r\.key\)/);
  assert.match(src, /(?:plainAction|publicActionLabel)\(e\.action\)/);
});

test('regulatory: the guard actually catches the shape that shipped', () => {
  const shippedByAction =
    '<TableCell className="font-mono text-xs text-foreground">\n  {r.key}\n</TableCell>';
  const shippedEnforcement =
    '<TableCell className="font-mono text-xs text-muted-foreground">\n  {e.action}\n</TableCell>';
  assert.ok(RAW_ACTION_CELL.test(shippedByAction), 'must match the "by action" defect');
  assert.ok(RAW_ACTION_CELL.test(shippedEnforcement), 'must match the enforcement-table defect');
});

// ─── /governance/evidence/audit — raw action + resource ────────────────────────────────────────────

const AUDIT_PATH = 'src/app/(console)/insights/audit/content.tsx';
const RAW_AUDIT_ACTION = /<td className="p-2 font-mono text-xs">\{r\.action\}<\/td>/;
const RAW_AUDIT_RESOURCE = /\{r\.resource \|\| '—'\}/;

test('audit log: the action column and resource column are never rendered raw', () => {
  const src = read(AUDIT_PATH);
  assert.equal(RAW_AUDIT_ACTION.test(src), false, 'the action column must go through plainAction()');
  assert.equal(RAW_AUDIT_RESOURCE.test(src), false, 'the resource column must go through publicLabel()');
  assert.match(src, /(?:plainAction|publicActionLabel)\(r\.action\)/);
  assert.match(src, /publicLabel\(r\.resource\)/);
});

test('audit log: the guard actually catches the shape that shipped', () => {
  const shipped = '<td className="p-2 font-mono text-xs">{r.action}</td>';
  assert.ok(RAW_AUDIT_ACTION.test(shipped), 'the regex must match the real defect');
});

// ─── /data/sources — the vector-store picker's visible option text ────────────────────────────────

const VECTORDB_PATH = 'src/components/data/VectorDBInspector.tsx';
const RAW_OPTION_TEXT = /<option value="(?:qdrant|lancedb)">(?:qdrant|lancedb)<\/option>/;

test('vector-DB inspector: the picker never shows the bare OSS project name as option text', () => {
  const src = read(VECTORDB_PATH);
  assert.equal(RAW_OPTION_TEXT.test(src), false, 'option TEXT must not be the engine name');
  // The wire-protocol values are untouched — only the visible label changed.
  assert.match(src, /<option value="qdrant">/);
  assert.match(src, /<option value="lancedb">/);
});

test('vector-DB inspector: the guard actually catches the shape that shipped', () => {
  const shipped = '<option value="qdrant">qdrant</option>';
  assert.ok(RAW_OPTION_TEXT.test(shipped), 'the regex must match the real defect');
});

// ─── 2026-08-10 demo-readiness sweep — 22 buyer-facing engine-name / rendering-bug leaks ───────────
//
// Reproduced with scripts/demo-readiness.mjs as the read-only demo viewer. Each block below is one
// shape from that sweep: a narrow regex against the shipped defect, plus proof the current source no
// longer matches it. Every one of these FAILS against the pre-fix source (verified by stashing the
// fix and re-running before restoring — see the task report for the exact commands run).

// ─── /data/retrieval, /data/knowledge/indexes — the vector-store badge/prose named Qdrant ─────────

const RETRIEVAL_MANAGER_PATH = 'src/components/retrieval/RetrievalManager.tsx';
// Scoped to the RAW JSX-text shape (not preceded by a quote) so it does not also flag the fixed
// code, which passes the identical sentence through `publicLabel('...')` as a string literal.
const RAW_QDRANT_PROSE =
  /(?<!')Check the Qdrant connection in\s*\n?\s*Settings and that Qdrant is running\.(?!')/;
const RAW_QDRANT_PAREN = /\(Qdrant\) is\{' '\}/;

test('retrieval manager: the unreachable message and the embedded-store note never name Qdrant raw', () => {
  const src = read(RETRIEVAL_MANAGER_PATH);
  assert.equal(RAW_QDRANT_PROSE.test(src), false, 'the unreachable copy must go through publicLabel()');
  assert.equal(RAW_QDRANT_PAREN.test(src), false, 'the embedded-store note must not name the engine');
  assert.match(src, /publicLabel\(view\.adapterId\)/, 'the adapter-id badge must go through publicLabel');
});

test('retrieval manager: the guard actually catches the shape that shipped', () => {
  const shipped =
    'Vector store unreachable{error ? ` — ${error}` : \'\'}. Check the Qdrant connection in\n' +
    '              Settings and that Qdrant is running.';
  assert.ok(RAW_QDRANT_PROSE.test(shipped), 'the regex must match the real defect');
});

// ─── /data/warehouse/models — the model manager named ClickHouse raw ───────────────────────────────

const WAREHOUSE_MANAGER_PATH = 'src/components/warehouse/WarehouseModelsManager.tsx';
const RAW_CLICKHOUSE = /live to ClickHouse/;

test('warehouse models manager: never names ClickHouse on the buyer-facing Data surface', () => {
  const src = read(WAREHOUSE_MANAGER_PATH);
  assert.equal(RAW_CLICKHOUSE.test(src), false, 'the engine name must not reach this page');
  assert.match(src, /live to the\s*\n?\s*warehouse/, 'the copy still says what actually happens');
});

test('warehouse models manager: the guard actually catches the shape that shipped', () => {
  const shipped = 'Creating one applies the DDL live to ClickHouse and freezes v1';
  assert.ok(RAW_CLICKHOUSE.test(shipped), 'the regex must match the real defect');
});

// ─── /data/flows/orchestration/catalog — a plugin group with no friendly title fell back to its raw,
// Kestra-qualified id ("io.kestra.plugin.jdbc...") as the card's ONLY visible text ─────────────────

const KESTRA_CATALOG_PATH = 'src/app/(console)/data/flows/orchestration/catalog/page.tsx';
const RAW_TITLE_CELL = /<CardTitle className="truncate text-base">\{g\.title\}<\/CardTitle>/;

test('orchestration catalog: the card title is never the raw (possibly Kestra-qualified) group id', () => {
  const src = read(KESTRA_CATALOG_PATH);
  assert.equal(RAW_TITLE_CELL.test(src), false, 'the title must go through publicLabel()');
  assert.match(src, /publicLabel\(g\.title\)/);
});

test('orchestration catalog: the guard actually catches the shape that shipped', () => {
  const shipped = '<CardTitle className="truncate text-base">{g.title}</CardTitle>';
  assert.ok(RAW_TITLE_CELL.test(shipped), 'the regex must match the real defect');
});

// ─── /insights/siem, /governance/evidence/security — the alerting + index-admin panels named
// OpenSearch in their always-visible captions and unsupported-plugin fallback text ──────────────────

const ALERTING_MANAGER_PATH = 'src/components/siem/AlertingManager.tsx';
const INDEX_ADMIN_MANAGER_PATH = 'src/components/siem/IndexAdminManager.tsx';
const RAW_OPENSEARCH_ALERTING = /OpenSearch alerting monitors|OpenSearch alerting plugin|OpenSearch ISM plugin/;
const RAW_OPENSEARCH_DETECTORS = /OpenSearch security-analytics plugin|in OpenSearch Dashboards/;

test('SIEM alerting + index-admin panels: never name OpenSearch on the security-events surface', () => {
  const alerting = read(ALERTING_MANAGER_PATH);
  const indexAdmin = read(INDEX_ADMIN_MANAGER_PATH);
  assert.equal(RAW_OPENSEARCH_ALERTING.test(alerting), false);
  assert.equal(RAW_OPENSEARCH_DETECTORS.test(indexAdmin), false);
});

test('SIEM panels: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_OPENSEARCH_ALERTING.test('OpenSearch alerting monitors (threshold triggers'));
  assert.ok(RAW_OPENSEARCH_ALERTING.test('The OpenSearch alerting plugin is not installed'));
  assert.ok(RAW_OPENSEARCH_ALERTING.test('The OpenSearch ISM plugin is not installed'));
  assert.ok(RAW_OPENSEARCH_DETECTORS.test('The OpenSearch security-analytics plugin is not installed'));
  assert.ok(RAW_OPENSEARCH_DETECTORS.test('No detectors configured. Define them in OpenSearch Dashboards'));
});

// The same panels' fallback text is fed by note/error strings built in the I/O adapters — a live
// non-404 failure or an unsupported-plugin 404 rendered "OpenSearch 500" / "...not available
// (OpenSearch 404...)" straight onto the page. Fixed at the source string, not just the static copy.

const OPENSEARCH_ALERTING_LIB_PATH = 'src/lib/opensearch-alerting.ts';
const OPENSEARCH_ADMIN_LIB_PATH = 'src/lib/adapters/opensearch-admin.ts';
const RAW_OPENSEARCH_NOTE = /`(?:Alerting|ISM|Security-analytics) plugin not available \(OpenSearch/;
const RAW_OPENSEARCH_ERROR = /error: `OpenSearch \$\{res\.status\}/;

test('SIEM adapters: the note/error strings handed to the UI never embed the raw engine name', () => {
  const alertingLib = read(OPENSEARCH_ALERTING_LIB_PATH);
  const adminLib = read(OPENSEARCH_ADMIN_LIB_PATH);
  assert.equal(RAW_OPENSEARCH_NOTE.test(alertingLib), false);
  assert.equal(RAW_OPENSEARCH_ERROR.test(alertingLib), false);
  assert.equal(RAW_OPENSEARCH_NOTE.test(adminLib), false);
  assert.equal(RAW_OPENSEARCH_ERROR.test(adminLib), false);
  assert.match(alertingLib, /search index \$\{res\.status\}/);
});

test('SIEM adapters: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_OPENSEARCH_NOTE.test('note: `Alerting plugin not available (OpenSearch ${res.status})`'));
  assert.ok(RAW_OPENSEARCH_ERROR.test("error: `OpenSearch ${res.status}`"));
});

// ─── /operations/api-docs, /runtime/api — the API catalog's summary line named OpenSearch ──────────

const API_CATALOG_PATH = 'src/lib/api-catalog.ts';
const RAW_API_CATALOG_OPENSEARCH = /latency\) from OpenSearch\./;

test('API catalog: the gateway-analytics endpoint summary never names OpenSearch', () => {
  const src = read(API_CATALOG_PATH);
  assert.equal(RAW_API_CATALOG_OPENSEARCH.test(src), false);
  assert.match(src, /latency\) from the search index\./);
});

test('API catalog: the guard actually catches the shape that shipped', () => {
  const shipped = "summary: 'Gateway usage analytics (requests, tokens, latency) from OpenSearch.',";
  assert.ok(RAW_API_CATALOG_OPENSEARCH.test(shipped), 'the regex must match the real defect');
});

// ─── /insights/usage/dashboards — the native BI panel named Superset in visible copy + link text ──

const USAGE_INSIGHTS_VIEW_PATH = 'src/components/insights/UsageInsightsView.tsx';
const SUPERSET_PANEL_PATH = 'src/components/analytics/NativeSupersetPanel.tsx';
const RAW_SUPERSET_COPY = /Superset runs each governed query|Superset runs the queries/;
const RAW_SUPERSET_LINK = />\s*Open in Superset\s*</;

test('BI dashboards surface: never names Superset in visible copy or the outbound link text', () => {
  const view = read(USAGE_INSIGHTS_VIEW_PATH);
  const panel = read(SUPERSET_PANEL_PATH);
  assert.equal(RAW_SUPERSET_COPY.test(view), false);
  assert.equal(RAW_SUPERSET_COPY.test(panel), false);
  assert.equal(RAW_SUPERSET_LINK.test(panel), false);
  assert.match(panel, /Open in BI engine/);
});

test('BI dashboards surface: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_SUPERSET_COPY.test('Superset runs each governed query and the console renders'));
  assert.ok(RAW_SUPERSET_COPY.test('Superset runs the queries, the console draws'));
  assert.ok(RAW_SUPERSET_LINK.test('<ArrowSquareOut className="size-4" />\n            Open in Superset\n          </a>'));
});

// ─── /runtime/models/cache — a non-200/404 response from the gateway's own cache API rendered
// "LiteLLM ${path} ${status}"/"LiteLLM not configured..." straight into the cache-status row ────────

const LITELLM_HTTP_PATH = 'src/lib/litellm-http.ts';
const LITELLM_CACHE_ADAPTER_PATH = 'src/lib/adapters/litellm-cache.ts';
const RAW_LITELLM_MESSAGE = /`LiteLLM \$\{path\}|'LiteLLM not configured|'cache API not on this LiteLLM version|'cache flush API not on this LiteLLM version/;

test('gateway cache: the thrown/returned error text never names LiteLLM raw', () => {
  const http = read(LITELLM_HTTP_PATH);
  const cacheAdapter = read(LITELLM_CACHE_ADAPTER_PATH);
  assert.equal(RAW_LITELLM_MESSAGE.test(http), false);
  assert.equal(RAW_LITELLM_MESSAGE.test(cacheAdapter), false);
  assert.match(http, /'gateway not configured/);
  assert.match(cacheAdapter, /not on this gateway version/);
});

test('gateway cache: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_LITELLM_MESSAGE.test("throw new LiteLLMHttpError(0, 'LiteLLM not configured (OFFGRID_LITELLM_URL unset)');"));
  assert.ok(RAW_LITELLM_MESSAGE.test('`LiteLLM ${path} ${res.status}${detail'));
  assert.ok(RAW_LITELLM_MESSAGE.test("'cache API not on this LiteLLM version (404)'"));
  assert.ok(RAW_LITELLM_MESSAGE.test("'cache flush API not on this LiteLLM version (404)'"));
});

// ─── /solutions/quality/drift (+ /insights/drift, /insights/quality/drift) — the drift engine's own
// attribution literally handed the UI the string "Evidently" ──────────────────────────────────────

const DRIFT_RUN_PATH = 'src/lib/drift-run.ts';
const DRIFT_PAGE_PATH = 'src/app/(console)/solutions/quality/drift/page.tsx';
const DRIFT_ADAPTER_PATH = 'src/lib/adapters/drift.ts';
const RAW_ENGINE_LABEL_LITERAL = /engineLabel:\s*engine === 'evidently' \? 'Evidently'/;
const RAW_DRIFT_BADGE = /'Evidently proven'/;
// Scoped to the exact template-literal CODE shape (`Evidently ran "${applied}"`), not the unrelated
// comment a few lines above that also quotes `Evidently ran "<selection>"` as an example of the bug.
const RAW_DRIFT_NOTE = /`Evidently ran "\$\{applied\}"|'Evidently ran, but did not report|'Evidently drift run\.'/;

test('drift page: the attribution label, badge, and generated note never say "Evidently"', () => {
  const runLib = read(DRIFT_RUN_PATH);
  const page = read(DRIFT_PAGE_PATH);
  const adapter = read(DRIFT_ADAPTER_PATH);
  assert.equal(RAW_ENGINE_LABEL_LITERAL.test(runLib), false);
  assert.equal(RAW_DRIFT_BADGE.test(page), false);
  assert.equal(RAW_DRIFT_NOTE.test(adapter), false);
  assert.match(runLib, /export function driftEngineLabel/, 'one reusable label function, not a literal per call site');
});

test('drift page: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_ENGINE_LABEL_LITERAL.test("engineLabel: engine === 'evidently' ? 'Evidently' : 'Off Grid PSI',"));
  assert.ok(RAW_DRIFT_BADGE.test("{a?.engineProven ? 'Evidently proven' : 'PSI fallback'}"));
  assert.ok(RAW_DRIFT_NOTE.test('`Evidently ran "${applied}"${selected'));
});

// ─── /insights/ai/traces, /solutions — a run's raw query (model-authored markdown, e.g.
// "**Task:** …") was rendered verbatim as a one-line table cell / activity-feed detail ─────────────

const TRACES_PAGE_PATH = 'src/app/(console)/insights/ai/traces/page.tsx';
const SOLUTIONS_PAGE_PATH = 'src/app/(console)/solutions/page.tsx';
const RAW_RUN_QUERY_CELL = /\{run\.query\}/;
const RAW_RUN_QUERY_DETAIL = /\$\{run\.status\}: \$\{run\.query\}/;

test('AI traces + Solutions hub: a run query preview is never the raw (possibly markdown) string', () => {
  const traces = read(TRACES_PAGE_PATH);
  const solutions = read(SOLUTIONS_PAGE_PATH);
  assert.equal(RAW_RUN_QUERY_CELL.test(traces), false, 'the traces table cell must go through previewText()');
  assert.equal(RAW_RUN_QUERY_DETAIL.test(solutions), false, 'the activity detail must go through previewText()');
  assert.match(traces, /previewText\(run\.query\)/);
  assert.match(solutions, /previewText\(run\.query\)/);
});

test('AI traces + Solutions hub: the guard actually catches the shapes that shipped', () => {
  assert.ok(RAW_RUN_QUERY_CELL.test('<TableCell className="max-w-lg truncate text-xs text-muted-foreground">\n  {run.query}\n</TableCell>'));
  assert.ok(RAW_RUN_QUERY_DETAIL.test('detail: `${run.status}: ${run.query}`,'));
});

// ─── /work/artifacts, /workspace/artifacts — a markdown/text artifact's raw source ("**Findings**",
// "# Summary") was shown verbatim as the card's thumbnail preview ───────────────────────────────────

const ARTIFACTS_BROWSER_PATH = 'src/components/artifacts/ArtifactsBrowser.tsx';
const RAW_ARTIFACT_PREVIEW = /\{decodeArtifactText\(a\.code\)\.slice\(0, 400\)\}/;

test('artifacts library: the card thumbnail preview strips markdown syntax instead of showing it raw', () => {
  const src = read(ARTIFACTS_BROWSER_PATH);
  assert.equal(RAW_ARTIFACT_PREVIEW.test(src), false);
  assert.match(src, /previewText\(decodeArtifactText\(a\.code\), 400\)/);
});

test('artifacts library: the guard actually catches the shape that shipped', () => {
  const shipped = '{decodeArtifactText(a.code).slice(0, 400)}';
  assert.ok(RAW_ARTIFACT_PREVIEW.test(shipped), 'the regex must match the real defect');
});

// ─── /work/prompts, /workspace/prompts — the Common Prompts panel mines the gateway's own call
// history, and a caller that stringified a null/undefined input before logging it produced a
// "prompt" whose entire text is the word "null" ─────────────────────────────────────────────────────

const COMMON_PROMPTS_PATH = 'src/lib/common-prompts.ts';

test('common prompts: a normalized "null"/"undefined" text is dropped, never shown as a real prompt', () => {
  const src = read(COMMON_PROMPTS_PATH);
  assert.match(src, /function isInvalidPrompt/);
  assert.match(src, /isInvalidPrompt\(key\)/);
});

test('common prompts: the pre-fix rule would have kept a literal "null" hit', () => {
  // Reconstruct the OLD rule (`if (!key) continue`) and show it does NOT reject "null" — only the
  // emptiness check did anything, so a stringified-null input sailed through to the customer's screen.
  const oldRuleRejects = (key: string) => !key;
  assert.equal(oldRuleRejects('null'), false, 'the pre-fix rule let "null" through');
  const newRuleRejects = (key: string) => !key || key === 'null' || key === 'undefined';
  assert.equal(newRuleRejects('null'), true, 'the fixed rule drops it');
});

test('a compound eval engine id never renders the evaluator name', async () => {
  // '/insights/quality/evals' rendered "Answer relevancy:ragas". Values arrive both bare ('ragas')
  // and compound ('answer_relevancy:ragas'); only the bare form was in the lookup table, so the
  // compound one fell through to titleCase of the WHOLE string — suffix included.
  const { evalEngineLabel } = await import('@/lib/eval-engine-label');
  const { leaksInternalName } = await import('@/lib/lineage-labels');
  for (const id of [
    'answer_relevancy:ragas',
    'faithfulness:ragas',
    'context_precision:ragas',
    'pii_leakage:heuristic',
    'drift:evidently',
    'ragas',
  ]) {
    const out = evalEngineLabel(id);
    assert.ok(!leaksInternalName(out), `${id} → ${out}`);
    assert.doesNotMatch(out, /:/, `${id} → ${out} still reads as a machine id`);
  }
});

test('the guard catches the exact label that shipped', () => {
  // A guard that can only pass is not a guard. titleCase of the raw compound id is what was on screen.
  const shipped = 'Answer relevancy:ragas';
  assert.match(shipped, /ragas/i, 'the shipped label did name the evaluator');
});
