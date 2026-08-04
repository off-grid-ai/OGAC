import { organizationalBrainForActor } from '@/lib/organizational-brain/server';
// The exact runtime the route builds, for an ADMIN subject — the only role this tenant's brain policy
// grants. Proves what the page renders for an authorized reader.
const { authorization, brain } = organizationalBrainForActor({
  tenantId: 'org_bharat', subjectId: 'priya.sharma@bharatunion.example', role: 'admin',
});
for (const q of ['savings', 'cross-sell', 'reimbursement']) {
  try {
    const r: any = await brain.search(authorization, { query: q, limit: 5 });
    console.log(`query "${q}" -> ${r.citations?.length ?? 0} citations`);
    for (const c of (r.citations ?? []).slice(0, 2)) {
      console.log(`   · ${c.title} [${c.sourceType}] "${String(c.excerpt ?? '').slice(0, 70)}…"`);
    }
  } catch (e: any) {
    console.log(`query "${q}" -> ERROR: ${e?.message?.slice(0, 140)}`);
  }
}
