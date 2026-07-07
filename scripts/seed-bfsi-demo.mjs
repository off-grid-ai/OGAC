// Indian BFSI demo seed — enriches the live console so the docs/landing screenshots show a full,
// on-brand Indian banking/insurance context. Creates governed apps (the hero surface) + ingests
// knowledge docs (so Chat answers cite real Indian BFSI content). Honest: connector-query steps bind
// to domain LABELS that already resolve to the REAL seeded on-prem sources — no fake bank connectors.
//
//   BASE=https://onprem-console.getoffgridai.co TOKEN=<admin> node scripts/seed-bfsi-demo.mjs
const BASE = process.env.BASE || 'https://onprem-console.getoffgridai.co';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('TOKEN (admin bearer) required'); process.exit(1); }
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  console.log(`${r.status}  POST ${path}  ${j?.id || j?.error || ''}`);
  return { status: r.status, json: j };
};

// ── Knowledge: real Indian BFSI SOPs/policies (grounds Chat + Brain with citations) ───────────────
const DOCS = [
  { title: 'Motor Claim FNOL SOP (IRDAI-aligned)', source: 'SOP · Motor Claims',
    text: `First Notice of Loss (FNOL) — motor own-damage. On intake capture: policy number, vehicle registration, IMEI/chassis, date & place of loss, and the insured's PAN. Verify the policy is in force on the date of loss and that premium is fully paid. Cashless is available only at network garages. For claims above ₹1,00,000 a surveyor visit is mandatory before approval; below ₹1,00,000 the desk may approve on photos. Salvage and depreciation are applied per the IRDAI motor schedule. Reject if the driving licence was invalid at the time of loss or the vehicle was used for hire without a commercial policy.` },
  { title: 'KYC & Periodic Re-KYC Policy (RBI Master Direction)', source: 'Policy · KYC',
    text: `Customer identification follows the RBI KYC Master Direction. Officially Valid Documents (OVDs): Aadhaar (masked), PAN, Passport, Voter ID, Driving Licence. PAN is mandatory for accounts and for any transaction above ₹50,000. Re-KYC cadence: high-risk customers every 2 years, medium every 8, low every 10. Name, PAN, and address must match across OVDs; a mismatch routes the case to manual review. UAPA/PEP screening runs on every onboarding. Aadhaar numbers are always stored masked (only last 4 digits visible).` },
  { title: 'Personal Loan Underwriting Guidelines', source: 'Policy · Lending',
    text: `Unsecured personal loan eligibility. Minimum net monthly income ₹25,000 (salaried) / ₹3,00,000 annual (self-employed). FOIR (fixed-obligations-to-income ratio) must stay below 50% after the new EMI. CIBIL score floor 730; 700–729 needs senior credit approval. Ticket size ₹50,000 to ₹40,00,000, tenure 12–60 months. Mandatory documents: PAN, salary slips (3 months), bank statement (6 months), and address OVD. Decline on CIBIL below 700, FOIR above 55%, or any write-off/settlement in the last 24 months.` },
];

// ── Apps: governed Indian BFSI workflows (Studio hero + 5-screen lifecycle + runs) ────────────────
const agent = (label, systemPrompt) => ({ kind: 'agent', label, inlineAgent: { grounded: true, systemPrompt } });
const read = (label, domain) => ({ op: 'read', kind: 'connector-query', label, domain });
const human = (label) => ({ kind: 'human', label });
const output = (label) => ({ kind: 'output', label, sink: 'report' });

const APPS = [
  { title: 'Motor Claim FNOL Triage',
    summary: 'Motor own-damage FNOL — read the policy & claim, check the vehicle is covered and premium paid, decide cashless vs surveyor, then route for approval. Amounts in ₹.',
    steps: [ read('Read the claim & policy', 'claims'), read('Look up the customer & vehicle', 'customers'),
      agent('Decide cashless vs surveyor', 'Given the FNOL claim, the in-force policy and the Motor Claim FNOL SOP, decide whether the claim can be settled cashless at a network garage or needs a surveyor (mandatory above ₹1,00,000). Cite the SOP. Never approve if the licence was invalid at the time of loss.'),
      human('Claims officer approval'), output('Claim decision + audit note') ] },
  { title: 'Personal Loan Underwriting Assist',
    summary: 'Personal-loan eligibility — pull the applicant and their transactions, compute FOIR and check the CIBIL/income floors from policy, then recommend approve/decline with reasons. Ticket ₹50k–₹40L.',
    steps: [ read('Pull the applicant', 'customers'), read('Pull 6-month bank statement', 'transactions'),
      agent('Assess eligibility (FOIR, CIBIL, income)', 'Using the Personal Loan Underwriting Guidelines, compute FOIR after the new EMI and check the CIBIL and income floors. Recommend approve, decline, or refer-to-senior with the specific reason and the policy clause. All amounts in ₹.'),
      human('Credit officer decision'), output('Underwriting recommendation') ] },
  { title: 'KYC & Re-KYC Verification',
    summary: 'Onboarding / periodic Re-KYC — read the customer OVDs, verify PAN and masked-Aadhaar consistency, screen PEP/UAPA, and flag mismatches for manual review per the RBI Master Direction.',
    steps: [ read('Read the customer & submitted OVDs', 'customers'),
      agent('Verify KYC per RBI Master Direction', 'Check that name, PAN and address match across the OVDs; PAN is mandatory. Aadhaar must be handled masked. Screen for PEP/UAPA. Per the KYC policy, route any mismatch to manual review. Cite the policy.'),
      human('Compliance review'), output('KYC verdict (verified / manual-review)') ] },
];

console.log('== ingesting Indian BFSI knowledge ==');
for (const d of DOCS) await post('/api/v1/admin/brain/documents', { title: d.title, text: d.text, source: d.source });

console.log('== creating governed BFSI apps ==');
for (const a of APPS) {
  const steps = a.steps.map((s, i) => ({ id: `s${i + 1}`, ...s }));
  // Chain the steps into one linear flow: s1 → s2 → … → sN (exactly one start step).
  const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id }));
  await post('/api/v1/admin/apps', { title: a.title, summary: a.summary, visibility: 'private', trigger: { kind: 'on-demand' }, steps, edges, published: true });
}

console.log('done.');
