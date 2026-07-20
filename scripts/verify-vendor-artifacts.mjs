#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = join(repositoryRoot, 'vendor', 'offgrid-ui');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(path) {
  const contents = await readFile(path);
  return createHash('sha256').update(contents).digest('hex');
}

async function verify() {
  const manifest = JSON.parse(await readFile(join(vendorRoot, 'release-manifest.json'), 'utf8'));
  invariant(manifest.schemaVersion === 1, 'Unsupported shared UI artifact manifest version.');
  invariant(
    manifest.authorization?.record === 'INTERNAL_USE_AUTHORIZATION.md',
    'Shared UI internal-use authorization record is missing from the manifest.',
  );
  await access(join(vendorRoot, manifest.authorization.record));

  const packages = manifest.packages;
  invariant(
    Array.isArray(packages) && packages.length === 2,
    'Expected exactly two reviewed Off Grid packages.',
  );

  const checksumLines = [];
  for (const entry of packages) {
    invariant(/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(entry.name), `Invalid package name: ${entry.name}`);
    invariant(/^[a-f0-9]{40}$/.test(entry.sourceSha), `Invalid source SHA for ${entry.name}.`);
    invariant(/^[a-f0-9]{64}$/.test(entry.sha256), `Invalid SHA-256 for ${entry.name}.`);
    invariant(
      entry.sourceRepository.startsWith('https://github.com/'),
      `Unpinned source repository for ${entry.name}.`,
    );
    invariant(
      !entry.archive.includes('/') && entry.archive.endsWith('.tgz'),
      `Invalid archive path for ${entry.name}.`,
    );

    const actual = await sha256(join(vendorRoot, entry.archive));
    invariant(
      actual === entry.sha256,
      `${entry.name} archive checksum mismatch: expected ${entry.sha256}, got ${actual}.`,
    );
    checksumLines.push(`${entry.sha256}  ${entry.archive}`);

    if (entry.licenseFile) await access(join(vendorRoot, entry.licenseFile));
  }

  const recorded = (await readFile(join(vendorRoot, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')
    .sort();
  invariant(
    JSON.stringify(recorded) === JSON.stringify(checksumLines.sort()),
    'SHA256SUMS and release-manifest.json do not describe the same artifacts.',
  );

  process.stdout.write(`Verified ${packages.length} pinned Off Grid UI artifacts.\n`);
}

await verify();
