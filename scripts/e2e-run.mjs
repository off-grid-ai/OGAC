// Run every ledger script and print the gate each one reports. Exit non-zero if any row is GAP —
// the ledger cannot be more optimistic than the evidence, so a red run is the honest outcome until
// the product earns otherwise.
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DIR = 'test/e2e';
const OUT = process.env.OUT || '/tmp/e2e';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const scripts = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs') && f !== 'lib.mjs')
  .filter((f) => !only || f.includes(only));

let gaps = 0;
for (const f of scripts) {
  const r = spawnSync(process.execPath, [`${DIR}/${f}`], {
    stdio: 'inherit',
    env: { ...process.env, OUT },
  });
  if (r.status !== 0) gaps++;
}
console.log(`\n${scripts.length - gaps}/${scripts.length} rows VERIFIED · ${gaps} GAP · artifacts in ${OUT}`);
process.exit(gaps ? 1 : 0);
