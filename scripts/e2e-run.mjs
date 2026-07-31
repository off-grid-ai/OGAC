// Run every ledger script and print the gate each one reports. Exit non-zero if any row is GAP —
// the ledger cannot be more optimistic than the evidence, so a red run is the honest outcome until
// the product earns otherwise.
import { readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// COUNT ROWS, NOT FILES. Two scripts (s12-surfaces, flows) each gate ten ledger rows, so an exit-code
// tally reported "4/8 VERIFIED" while 18 of 22 rows were green. A headline that understates or overstates
// the evidence is the exact failure this ledger exists to prevent, so the summary is parsed from the
// VERIFIED/GAP lines the rows themselves print.

const DIR = 'test/e2e';
const OUT = process.env.OUT || '/tmp/e2e';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const scripts = readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs') && f !== 'lib.mjs')
  .filter((f) => !only || f.includes(only));

let verified = 0;
let gaps = 0;
for (const f of scripts) {
  const r = spawnSync(process.execPath, [`${DIR}/${f}`], { encoding: 'utf8', env: { ...process.env, OUT } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out.split('\n').filter((l) => /^(VERIFIED|GAP)\t/.test(l)).join('\n') + '\n');
  for (const line of out.split('\n')) {
    if (line.startsWith('VERIFIED\t')) verified++;
    else if (line.startsWith('GAP\t')) gaps++;
  }
  // A script that dies without printing a verdict is itself a GAP — silence is never a pass.
  if (!/^(VERIFIED|GAP)\t/m.test(out)) {
    gaps++;
    console.log(`GAP\t${f}\tscript produced no verdict (exit ${r.status})`);
  }
}
const total = verified + gaps;
console.log(`\n${verified}/${total} ledger rows VERIFIED · ${gaps} GAP · artifacts in ${OUT}`);
process.exit(gaps ? 1 : 0);
