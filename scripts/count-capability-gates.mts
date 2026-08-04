// Count the capability gates from the SYSTEM OF RECORD (src/lib/service-capability-map.ts).
//
// WHY THIS EXISTS: the counts in docs/OSS_LEVERAGE.md were hand-maintained and drifted three separate
// ways — the doc said 70 fully leveraged, a later summary said 82, and the truth was 83. A number that
// has to be retyped after every change will be wrong; one that is derived cannot be.
//
//   npx tsx scripts/count-capability-gates.mts          # human summary
//   npx tsx scripts/count-capability-gates.mts --json    # machine readable
//
// "Under-leveraged" has the definition the ledger uses: the upstream service says YES and at least one
// of OUR gates does not. That deliberately excludes items upstream cannot do — those are not our gap.
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';

const GATES = ['upstream', 'adapter', 'ui', 'workflow'] as const;

const perGate: Record<string, Record<string, number>> = {};
for (const g of GATES) perGate[g] = {};

let services = 0;
let items = 0;
let fullyLeveraged = 0;
let underLeveraged = 0;
let upstreamCannot = 0;
const underLeveragedBy: { service: string; item: string; missing: string[] }[] = [];

for (const service of SERVICE_CAPABILITY_AUDITS as any[]) {
  services++;
  for (const item of service.items ?? []) {
    items++;
    const status = (g: string): string => String(item.gates?.[g]?.status);
    for (const g of GATES) perGate[g][status(g)] = (perGate[g][status(g)] ?? 0) + 1;

    const ours = ['adapter', 'ui', 'workflow'] as const;
    if (GATES.every((g) => status(g) === 'yes')) {
      fullyLeveraged++;
    } else if (status('upstream') !== 'yes') {
      upstreamCannot++;
    } else {
      underLeveraged++;
      underLeveragedBy.push({
        service: service.name ?? service.id,
        item: item.name ?? item.id,
        missing: ours.filter((g) => status(g) !== 'yes').map((g) => `${g}:${status(g)}`),
      });
    }
  }
}

const summary = { services, items, fullyLeveraged, underLeveraged, upstreamCannot, perGate };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...summary, underLeveragedBy }, null, 2));
} else {
  console.log(`services              ${services}`);
  console.log(`capability items      ${items}`);
  console.log(`fully leveraged       ${fullyLeveraged}  (all four gates yes)`);
  console.log(`under-leveraged       ${underLeveraged}  (upstream yes, one of ours not)`);
  console.log(`upstream cannot       ${upstreamCannot}  (not our gap)`);
  console.log(`\nper gate:`);
  for (const g of GATES) console.log(`  ${g.padEnd(9)} ${JSON.stringify(perGate[g])}`);
  // Sanity: the three buckets must account for every item, or a status value went unhandled.
  const accounted = fullyLeveraged + underLeveraged + upstreamCannot;
  if (accounted !== items) {
    console.log(`\n!! ${items - accounted} items unaccounted for — a gate status is not being classified`);
    process.exitCode = 1;
  }
}
