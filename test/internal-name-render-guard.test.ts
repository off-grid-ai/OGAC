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
  assert.match(src, /plainAction\(r\.key\)/);
  assert.match(src, /plainAction\(e\.action\)/);
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
  assert.match(src, /plainAction\(r\.action\)/);
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
