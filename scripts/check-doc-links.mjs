#!/usr/bin/env node
// Off Grid Console — docs dead-link checker (#226).
//
// Walks every Markdown file under docs/ (+ the top-level README.md / CLAUDE.md)
// and checks that INTERNAL links resolve:
//   - relative file links (./foo.md, ../deploy/DEPLOY.md, images) must point at a
//     file that exists on disk;
//   - repo-absolute links (docs/…, public/…, src/…) resolve from the repo root;
//   - intra-doc anchors (#section) must match a heading in the same file;
//   - cross-file anchors (other.md#section) check the file exists (anchor within
//     it is best-effort — we verify the file, warn on a missing anchor).
// EXTERNAL links (http/https/mailto) are NOT fetched — a network failure or a
// transiently-down site must not fail the gate. They are counted and reported.
//
// EXIT: 1 if any INTERNAL link is broken (blocks the push / fails CI); 0 otherwise.
// Pure Node, no deps — runs anywhere `node` runs.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

// Collect the Markdown files to check: everything under docs/, plus the two
// top-level guides. Use git ls-files so we only check tracked docs.
function listMarkdown() {
  const tracked = execSync('git ls-files', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split('\n')
    .filter(Boolean);
  return tracked.filter(
    (f) => f.endsWith('.md') && (f.startsWith('docs/') || f === 'README.md' || f === 'CLAUDE.md'),
  );
}

// Extract [text](target) links, ignoring fenced code blocks + inline code.
function extractLinks(md) {
  const withoutFences = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(withoutFences)) !== null) links.push(m[1]);
  return links;
}

// Headings → GitHub-style anchor slugs, for intra-doc #anchor checks.
function headingSlugs(md) {
  const slugs = new Set();
  for (const line of md.split('\n')) {
    const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (!h) continue;
    const slug = h[1]
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (slug) slugs.add(slug);
  }
  return slugs;
}

const isExternal = (t) => /^(https?:|mailto:|tel:)/i.test(t);

// Best-effort resolver: does a Next.js app route exist for an in-product URL like
// /fleet-control or /handbook/agent-qa? Walk src/app segment by segment; a
// segment matches a literal dir OR any [dynamic]/[[...catch-all]] sibling. A
// route "exists" if the final dir holds a page/route file, or we bottomed out on
// a dynamic segment (which handles arbitrary tails).
function appRouteExists(urlPath) {
  const APP = join(ROOT, 'src', 'app');
  if (!existsSync(APP)) return true; // can't check → don't warn
  const segments = urlPath.split('#')[0].split('/').filter(Boolean);
  // Candidate current directories (Next route groups (foo) are transparent).
  let dirs = [APP, ...routeGroupDirs(APP)];
  for (const seg of segments) {
    const next = [];
    for (const d of dirs) {
      const literal = join(d, seg);
      if (existsSync(literal) && statSync(literal).isDirectory()) {
        next.push(literal, ...routeGroupDirs(literal));
      }
      // Dynamic segment: [slug] / [...slug] — matches anything.
      for (const dyn of dynamicChildDirs(d)) next.push(dyn, ...routeGroupDirs(dyn));
    }
    if (next.length === 0) return false;
    dirs = next;
  }
  return dirs.some(
    (d) =>
      existsSync(join(d, 'page.tsx')) ||
      existsSync(join(d, 'page.ts')) ||
      existsSync(join(d, 'route.ts')) ||
      // A dynamic dir we stopped on serves the route.
      /\[.*\]$/.test(d),
  );
}

function childDirs(d) {
  try {
    return execSync(`ls -1 "${d}"`, { stdio: ['pipe', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .filter(Boolean)
      .map((n) => join(d, n))
      .filter((p) => existsSync(p) && statSync(p).isDirectory());
  } catch {
    return [];
  }
}
const routeGroupDirs = (d) => childDirs(d).filter((p) => /\([^)]+\)$/.test(p.split('/').pop()));
const dynamicChildDirs = (d) => childDirs(d).filter((p) => /^\[.*\]$/.test(p.split('/').pop()));

const broken = [];
let externalCount = 0;
let anchorWarnings = 0;
let checked = 0;

for (const file of listMarkdown()) {
  const abs = join(ROOT, file);
  const md = readFileSync(abs, 'utf8');
  const ownSlugs = headingSlugs(md);

  for (const raw of extractLinks(md)) {
    if (isExternal(raw)) {
      externalCount++;
      continue;
    }
    checked++;
    const [pathPart, anchor] = raw.split('#');

    // Pure intra-doc anchor (#section).
    if (pathPart === '' && anchor !== undefined) {
      if (!ownSlugs.has(anchor.toLowerCase())) {
        anchorWarnings++;
        console.warn(`  warn  ${file}: intra-doc anchor #${anchor} has no matching heading`);
      }
      continue;
    }

    // A leading-slash link is an in-PRODUCT app route (e.g. /fleet-control,
    // /handbook/agent-qa), NOT a repo file path. Verify a Next.js route exists
    // under src/app for it (static segment or a [dynamic] parent); WARN (do not
    // fail) if we can't resolve one — routes can be dynamic in ways this static
    // check won't see, and a doc pointing at a live URL is not a dead file link.
    if (pathPart.startsWith('/')) {
      if (!appRouteExists(pathPart)) {
        anchorWarnings++;
        console.warn(`  warn  ${file}: in-product route ${pathPart} — no matching src/app route found`);
      }
      continue;
    }

    // Resolve the target file: repo-relative dir (docs/…, public/…) vs a path
    // relative to the current doc.
    const looksRepoRooted = /^(docs|public|src|deploy|scripts|test)\//.test(pathPart);
    const targetAbs = looksRepoRooted
      ? join(ROOT, pathPart)
      : resolve(dirname(abs), pathPart);

    if (!existsSync(targetAbs)) {
      broken.push({ file, link: raw, resolved: relative(ROOT, targetAbs) });
      continue;
    }

    // If it points at a markdown file with a cross-file anchor, best-effort check.
    if (anchor && statSync(targetAbs).isFile() && targetAbs.endsWith('.md')) {
      const targetSlugs = headingSlugs(readFileSync(targetAbs, 'utf8'));
      if (!targetSlugs.has(anchor.toLowerCase())) {
        anchorWarnings++;
        console.warn(`  warn  ${file}: ${pathPart}#${anchor} — file exists, anchor not found`);
      }
    }
  }
}

console.log(
  `docs:links: checked ${checked} internal links across markdown docs ` +
    `(${externalCount} external links skipped, ${anchorWarnings} anchor warnings).`,
);

if (broken.length > 0) {
  console.error(`\ndocs:links: FAILED — ${broken.length} broken INTERNAL link(s):`);
  for (const b of broken) console.error(`  x  ${b.file}: [${b.link}] -> ${b.resolved} (missing)`);
  process.exit(1);
}

console.log('docs:links: OK — all internal links resolve.');
