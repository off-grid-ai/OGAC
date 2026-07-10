#!/usr/bin/env node
//
// Off Grid Console — documentation dead-link gate (#226).
//
// Thin I/O runner over the PURE rules in src/lib/doc-links.ts. It:
//   1. finds every tracked markdown file (docs/ + repo-root *.md),
//   2. extracts each link and classifies it (internal / external / ignored),
//   3. resolves INTERNAL links against the filesystem — a missing target FAILS,
//   4. reports EXTERNAL links as WARNings (network-dependent → never blocks).
//
// Exit 1 iff at least one internal link is broken. See src/lib/doc-links.ts for
// the policy rationale. Run:  npm run docs:links
//
// The pure module is TypeScript; we import it via a tiny inline type-strip so
// this stays a dependency-free node script (no build step for the gate).

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Load the pure rules. Node can strip types natively (>=22.6 with the flag,
// >=23 by default); to stay robust across versions we shell out to a one-shot
// type-stripping import via the same flag the test suite uses.
const rules = await loadRules();
const { classifyLink, splitFragment, extractLinks, gateExitCode } = rules;

async function loadRules() {
  const mod = pathToFileURL(join(ROOT, 'src/lib/doc-links.ts')).href;
  try {
    return await import(mod); // Node with native type-stripping.
  } catch {
    // Fallback: strip types to a temp .mjs via the TS compiler already present.
    const ts = join(ROOT, 'src/lib/doc-links.ts');
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(ts).href)}).then(m=>process.stdout.write('ok'))`],
      { cwd: ROOT },
    );
    void out;
    return await import(mod);
  }
}

/** Recursively collect markdown files under a dir. */
function walkMarkdown(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMarkdown(full));
    else if (entry.name.toLowerCase().endsWith('.md')) found.push(full);
  }
  return found;
}

function rootMarkdown() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => join(ROOT, e.name));
}

/** Does an internal link target resolve to a real file/dir on disk? */
function internalTargetExists(fromFile, linkPath) {
  if (linkPath === '') return true; // same-file anchor — nothing to resolve.
  // Internal links are RELATIVE by classification (repo-absolute `/…` links are
  // classified as in-app routes and never reach here). Resolve against the doc.
  const base = dirname(fromFile);
  const target = resolve(base, linkPath);
  if (existsSync(target)) return true;
  // A directory link may implicitly point at its README.md / index.md.
  try {
    if (statSync(target).isDirectory()) {
      return existsSync(join(target, 'README.md')) || existsSync(join(target, 'index.md'));
    }
  } catch {
    /* not a dir */
  }
  return false;
}

const files = [...new Set([...walkMarkdown(join(ROOT, 'docs')), ...rootMarkdown()])];

let broken = 0;
let warned = 0;
const brokenList = [];
const warnList = [];

for (const file of files) {
  const md = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  for (const link of extractLinks(md)) {
    const kind = classifyLink(link);
    if (kind === 'ignored') continue;
    if (kind === 'external') {
      warned += 1;
      warnList.push(`  ${rel} → ${link}`);
      continue;
    }
    // internal
    const { path: linkPath } = splitFragment(link);
    if (!internalTargetExists(file, linkPath)) {
      broken += 1;
      brokenList.push(`  ${rel} → ${link}  (target not found)`);
    }
  }
}

console.log(`docs:links — scanned ${files.length} markdown files.`);
if (warned > 0) {
  console.log(`docs:links: ${warned} external link(s) (WARN — not verified, do not block):`);
  for (const w of warnList) console.log(w);
}
if (broken > 0) {
  console.error(`docs:links: FAILED — ${broken} broken INTERNAL link(s):`);
  for (const b of brokenList) console.error(b);
  console.error('docs:links: fix the internal link targets above (relative paths within the repo).');
} else {
  console.log('docs:links: OK — no broken internal links.');
}

process.exit(gateExitCode(broken));
