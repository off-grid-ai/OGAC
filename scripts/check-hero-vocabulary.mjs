// ─── The KILL-list check — our engineering vocabulary must not reach a customer's screen ───────────
//
// The hero script's governing rule "overrides everything on screen": lead with the outcome, speak to
// "you", and keep our vocabulary out of sight. That rule applies to the console too — the same CIO is
// inside the product ninety seconds after the loop ends, and `docs/HERO_CLAIMS.md` carries it as
// claim P3.
//
// A one-off sweep is worthless here: the leak is systemic (ABAC in 11 files, langfuse in 20,
// opensearch in 13), and anything cleaned by hand comes straight back with the next feature. So this
// is a RATCHET, not a pass/fail wall:
//
//   • A BASELINE records the current count per term. The check fails when a count goes UP.
//   • Clearing terms lowers the baseline, and the ratchet holds the new floor.
//
// That makes the leak stop growing today, without pretending 148 occurrences of "pipeline" can be
// renamed in one commit. `--update` rewrites the baseline (review the diff — a rise should be a
// deliberate decision, not a rubber stamp).
//
//   node scripts/check-hero-vocabulary.mjs            # verify against the baseline
//   node scripts/check-hero-vocabulary.mjs --update   # re-record it
//
// WHAT IS SCANNED: only the surfaces a customer can see — `src/app/**` and `src/components/**` .tsx.
// Server logic, adapters and tests may say `presidio` all day; that is not a screen.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BASELINE = join(ROOT, 'scripts/hero-vocabulary-baseline.json');
const SCAN_DIRS = ['src/app', 'src/components'];

// Our vocabulary, from the script's KILL list. Word-boundary matched, case-insensitive.
const TERMS = [
  'ETL', 'CDC', 'RBAC', 'ABAC', 'OPA', 'DLP',
  'pipeline', 'semantic model', 'vector index', 'retrieval index', 'derived',
  // OSS / vendor product names — never on a customer's screen.
  'ragas', 'evidently', 'presidio', 'kestra', 'clickhouse', 'seaweedfs', 'openbao',
  'qdrant', 'temporal', 'langfuse', 'opensearch', 'superset', 'airbyte', 'dbt',
  'llm guard', 'litellm', 'keycloak',
];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Count files containing each term.
 *
 * FILE counts, not occurrence counts, deliberately: a file either leaks a term or it does not, and
 * counting occurrences makes the baseline churn on unrelated edits (a reformat, an extra usage in code
 * that was already flagged) without the leak actually widening.
 */
export function countTerms(files, read = (f) => readFileSync(f, 'utf8')) {
  const counts = {};
  const hits = {};
  for (const term of TERMS) {
    counts[term] = 0;
    hits[term] = [];
  }
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    for (const term of TERMS) {
      // \b does not work around a space, so multi-word terms are matched plainly.
      const re = term.includes(' ')
        ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        : new RegExp(`\\b${term}\\b`, 'i');
      if (re.test(text)) {
        counts[term] += 1;
        hits[term].push(relative(ROOT, file));
      }
    }
  }
  return { counts, hits };
}

/** Terms whose count exceeds the baseline. Pure, so the ratchet itself is testable. */
export function regressions(counts, baseline) {
  const out = [];
  for (const [term, count] of Object.entries(counts)) {
    const allowed = baseline[term] ?? 0;
    if (count > allowed) out.push({ term, count, allowed });
  }
  return out.sort((a, b) => b.count - a.count - (b.allowed - a.allowed));
}


/**
 * Occurrences in text a USER CAN READ — JSX text nodes and label/title/description/placeholder strings.
 *
 * WHY A SECOND METRIC. The file-level count above prevents the leak GROWING, but it cannot see a copy fix:
 * `LangfuseTraces.tsx` still contains "langfuse" in its component name and fetch path long after the
 * on-screen string is gone, so clearing "Langfuse error:" moved the file count by zero. Claim P3 is about
 * what reaches a customer's SCREEN, so it needs a metric that measures exactly that — otherwise the gate
 * says "no regression" while the claim stays unprovable either way.
 *
 * Deliberately narrower than the file scan and NOT a replacement for it: an engine name in a component
 * name is fine, in a heading it is not. Both counts ratchet independently.
 */
export function countVisible(files, read = (f) => readFileSync(f, 'utf8')) {
  const counts = {};
  const hits = {};
  for (const term of TERMS) {
    counts[term] = 0;
    hits[term] = [];
  }
  for (const file of files) {
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    for (const term of TERMS) {
      const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bound = term.includes(' ') ? esc : `\\b${esc}\\b`;
      // JSX text between tags, and the common label-ish string props.
      const patterns = [
        new RegExp(`>[^<>{}]*${bound}`, 'i'),
        new RegExp(`(?:label|title|heading|description|placeholder|summary|caption)["']?\\s*[:=]\\s*["'\`][^"'\`]*${bound}`, 'i'),
      ];
      const n = patterns.filter((re) => re.test(text)).length;
      if (n > 0) {
        counts[term] += 1;
        hits[term].push(relative(ROOT, file));
      }
    }
  }
  return { counts, hits };
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const { counts, hits } = countTerms(files);
const visible = countVisible(files);
const update = process.argv.includes('--update');
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({ files: counts, visible: visible.counts }, null, 2)}\n`);
  console.log(
    `baseline written: ${Object.keys(counts).length} terms · ${sum(counts)} flagged files · ` +
      `${sum(visible.counts)} with the term in VISIBLE text · ${files.length} scanned`,
  );
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('No baseline. Run: node scripts/check-hero-vocabulary.mjs --update');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(BASELINE, 'utf8'));
// Older baselines are a flat term→count map of the FILE metric; read them as such so an existing
// baseline keeps working instead of silently comparing against zeros (which would fail every term).
const baseline = raw.files ?? raw;
const visibleBaseline = raw.visible ?? null;
const bad = regressions(counts, baseline);
const badVisible = visibleBaseline ? regressions(visible.counts, visibleBaseline) : [];

const improved = Object.entries(counts).filter(([t, c]) => c < (baseline[t] ?? 0));
if (improved.length > 0) {
  console.log('Improved (lower the baseline with --update to lock these in):');
  for (const [term, count] of improved) console.log(`  ${term}: ${baseline[term]} → ${count}`);
}

const improvedVisible = visibleBaseline
  ? Object.entries(visible.counts).filter(([t, c]) => c < (visibleBaseline[t] ?? 0))
  : [];
if (improvedVisible.length > 0) {
  console.log('Improved ON SCREEN (lower the baseline with --update to lock these in):');
  for (const [term, count] of improvedVisible) {
    console.log(`  ${term}: ${visibleBaseline[term]} → ${count} files with it in visible text`);
  }
}

if (bad.length === 0 && badVisible.length === 0) {
  console.log(
    `✓ no new customer-facing vocabulary leaks (${sum(counts)} flagged files, ` +
      `${sum(visible.counts)} with the term ON SCREEN, ${files.length} scanned)`,
  );
  process.exit(0);
}

console.error('\n✗ Our engineering vocabulary reached a customer-facing surface.\n');
console.error('   docs/HERO_CLAIMS.md claim P3: the hero script\'s rule applies to the console too.\n');
for (const { term, count, allowed } of badVisible) {
  console.error(`  ON SCREEN — ${term}: ${count} files (baseline ${allowed})`);
  for (const f of visible.hits[term].slice(0, 6)) console.error(`      ${f}`);
}
for (const { term, count, allowed } of bad) {
  console.error(`  ${term}: ${count} files (baseline ${allowed})`);
  for (const f of hits[term].slice(0, 6)) console.error(`      ${f}`);
  if (hits[term].length > 6) console.error(`      … and ${hits[term].length - 6} more`);
}
console.error('\n   Rename it for the reader, or — if this is genuinely not on a screen — run --update and');
console.error('   say why in the commit. A rising baseline should be a decision, not a reflex.\n');
process.exit(1);
