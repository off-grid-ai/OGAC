#!/usr/bin/env node
// Seed the SOURCE DATA for the Suraksha Life (org_suraksha) INSURER tenant so the 15 insurer use
// cases resolve against REAL, live-queryable rows at run time. This is the insurer counterpart of
// deploy/onprem/seed-insurer-usecases.mjs (which seeds the bank-flavoured bharatunion tenant).
//
// ISOLATION: Suraksha must NOT share bharatunion's databases. This creates SEPARATE databases on the
// SAME shared demo servers:
//   • Postgres  `suraksha`  on the corebank server (:5433) — policies, premiums, claims,
//     claim_documents, kyc_documents, pricing_rfq, pricing_rate_card, helpdesk_cases, competitor_products
//   • MySQL     `suraksha`  on the policyadmin server (:3307) — advisors, candidates, job_requisitions,
//     employee_quota
// The connector-query TOOL executes through connector-exec (postgres/mysql), so the rows MUST live in
// these container DBs the org_suraksha data-domains point at (see src/lib/suraksha-tenant-seed.ts +
// deploy/onprem/reconcile-suraksha-connectors.sql, which repoints the connectors at db `suraksha`).
//
// Usage (on S1, 127.0.0.1 loopback reaches the containers):
//   node deploy/onprem/seed-suraksha-dataplane.mjs
//
// Env (defaults = the demo containers' creds, mirror data-sources.yml):
//   DS_HOST        default 127.0.0.1     (data-source host; the shared corebank/policyadmin servers)
//   PG_PORT        default 5433          PG_ADMIN_DB default corebank   PG_USER/PG_PASS default corebank
//   MYSQL_PORT     default 3307          MYSQL_USER/MYSQL_PASS default policyadmin
//   SURAKSHA_DB    default suraksha      (the isolated per-tenant DB/schema name; must be [a-z][a-z0-9_]*)
//
// Idempotent: CREATE DATABASE/SCHEMA IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, TRUNCATE before load.
// Deterministic (mulberry32 seed distinct from the other seeds) so re-runs are stable.

const DS_HOST = process.env.DS_HOST || '127.0.0.1';
const PG_PORT = parseInt(process.env.PG_PORT || '5433', 10);
const PG_ADMIN_DB = process.env.PG_ADMIN_DB || 'corebank';
const PG_USER = process.env.PG_USER || 'corebank';
const PG_PASS = process.env.PG_PASS || 'corebank';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3307', 10);
const MYSQL_USER = process.env.MYSQL_USER || 'policyadmin';
const MYSQL_PASS = process.env.MYSQL_PASS || 'policyadmin';
const SURAKSHA_DB = process.env.SURAKSHA_DB || 'suraksha';
if (!/^[a-z][a-z0-9_]*$/.test(SURAKSHA_DB)) {
  throw new Error(`Invalid SURAKSHA_DB "${SURAKSHA_DB}" — must be a safe identifier ([a-z][a-z0-9_]*).`);
}

// ------------------------------------------------------------------ seeded PRNG (mulberry32)
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(0x5c2a9f13); // distinct seed → uncorrelated with the bank tenant
const rnd = () => rng();
const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weightedPick(pairs) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let x = rnd() * total;
  for (const [v, w] of pairs) if ((x -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}
function round2(n) { return Math.round(n * 100) / 100; }

// ------------------------------------------------------------------ Indian reference data
const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Kabir', 'Ayaan', 'Dhruv', 'Aryan', 'Karan', 'Rahul', 'Amit', 'Suresh', 'Ramesh', 'Vijay',
  'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Pari', 'Anika', 'Navya', 'Aarohi', 'Myra', 'Ira',
  'Priya', 'Pooja', 'Neha', 'Kavya', 'Sneha', 'Deepika', 'Lakshmi', 'Meena', 'Sunita', 'Anjali',
  'Farhan', 'Zoya', 'Imran', 'Ayesha', 'Rehan', 'Fatima', 'Bilal', 'Zara', 'Rizwan', 'Sana',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Reddy', 'Nair', 'Menon', 'Iyer', 'Iyengar',
  'Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Chowdhury', 'Banerjee', 'Mukherjee', 'Das', 'Bose',
  'Rao', 'Naidu', 'Pillai', 'Kaur', 'Gill', 'Khan', 'Ahmed', 'Agarwal', 'Malhotra', 'Kapoor',
];
const CITIES = ['Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Gurugram', 'Kochi', 'Indore', 'Nagpur', 'Surat'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
function randLetters(n) { let s = ''; for (let i = 0; i < n; i++) s += LETTERS[randInt(0, 25)]; return s; }
function randDigits(n) { let s = ''; for (let i = 0; i < n; i++) s += DIGITS[randInt(0, 9)]; return s; }
function genPan() { return randLetters(5) + randDigits(4) + randLetters(1); }
function maskPan(p) { return p.slice(0, 3) + 'XXXX' + p.slice(-1); }
function maskAadhaar() { return 'XXXX XXXX ' + randDigits(4); }
function name() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }
const NOW = new Date('2026-07-09T12:00:00Z').getTime();
const DAY = 86400000;
function daysAgo(n) { return new Date(NOW - n * DAY); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function fmtDateTime(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

// ------------------------------------------------------------------ counts
const N_POLICY = 600;
const N_CLAIM = 220;
const N_CLAIM_DOC = 400;
const N_KYC = 300;
const N_RFQ = 120;
const N_HELPDESK = 300;
const N_COMPETITOR = 80;
const N_ADVISOR = 250;
const N_EMPLOYEE = 500;
const N_CAND_PER_REQ = [8, 22];

// ================================================================== generators (LIFE-INSURER book)
const PLAN_TYPES = ['Term', 'ULIP', 'Endowment', 'Money Back', 'Whole Life', 'Pension/Annuity', 'Child Plan'];
const PREMIUM_MODES = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly'];
const POLICY_STATUS = [['in_force', 62], ['lapsed', 16], ['paid_up', 9], ['surrendered', 6], ['matured', 4], ['grace', 3]];

function genPolicies() {
  const rows = [];
  for (let i = 1; i <= N_POLICY; i++) {
    const plan = weightedPick([['Term', 26], ['ULIP', 22], ['Endowment', 18], ['Money Back', 10], ['Whole Life', 8], ['Pension/Annuity', 9], ['Child Plan', 7]]);
    const sa = pick([500000, 1000000, 1500000, 2500000, 5000000, 10000000]);
    const issued = daysAgo(randInt(60, 4000));
    const termYears = plan === 'Term' ? pick([10, 20, 30]) : pick([12, 15, 20, 25]);
    const annualPrem = round2(sa * (plan === 'Term' ? 0.004 : plan === 'ULIP' ? 0.06 : 0.05) * (0.7 + rnd() * 0.6));
    rows.push({
      policy_no: 'SL' + randDigits(10),
      holder_name: name(),
      pan: genPan(),
      plan_type: plan,
      sum_assured_inr: sa.toFixed(2),
      annual_premium_inr: annualPrem.toFixed(2),
      premium_mode: pick(PREMIUM_MODES),
      status: weightedPick(POLICY_STATUS),
      issue_date: fmtDate(issued),
      maturity_date: fmtDate(new Date(issued.getTime() + termYears * 365 * DAY)),
      nominee_name: name(),
      city: pick(CITIES),
    });
  }
  return rows;
}

function genPremiums(policies) {
  const rows = [];
  let id = 1;
  for (const p of policies) {
    const n = randInt(1, 6);
    for (let k = 0; k < n; k++) {
      const due = daysAgo(randInt(0, 900));
      const paid = rnd() < 0.8;
      rows.push({
        premium_id: 'PRM' + String(id++).padStart(8, '0'),
        policy_no: p.policy_no,
        amount_inr: round2(Number(p.annual_premium_inr) / (p.premium_mode === 'Monthly' ? 12 : p.premium_mode === 'Quarterly' ? 4 : p.premium_mode === 'Semi-Annual' ? 2 : 1)).toFixed(2),
        due_date: fmtDate(due),
        paid_date: paid ? fmtDate(new Date(due.getTime() + randInt(-5, 20) * DAY)) : null,
        mode: p.premium_mode,
        status: paid ? 'paid' : weightedPick([['due', 60], ['overdue', 40]]),
      });
    }
  }
  return rows;
}

const CLAIM_TYPES = [['Death', 50], ['Maturity', 25], ['Surrender', 15], ['Rider', 10]];
const DEATH_CAUSES = ['Natural', 'Accident', 'Illness — cardiac', 'Illness — cancer', 'COVID-19', 'Unknown — under investigation'];
const CLAIM_STATUS = [['intimated', 20], ['under_review', 25], ['documents_pending', 18], ['approved', 22], ['settled', 10], ['repudiated', 5]];
function genClaims(policies) {
  const rows = [];
  for (let i = 1; i <= N_CLAIM; i++) {
    const p = pick(policies);
    const ctype = weightedPick(CLAIM_TYPES);
    const intimated = daysAgo(randInt(0, 400));
    const issued = new Date(p.issue_date).getTime();
    const withinContestability = intimated.getTime() - issued < 3 * 365 * DAY;
    rows.push({
      claim_id: 'CLM' + String(i).padStart(7, '0'),
      policy_no: p.policy_no,
      claimant_name: ctype === 'Death' ? p.nominee_name : p.holder_name,
      claim_type: ctype,
      intimated_date: fmtDate(intimated),
      cause_of_death: ctype === 'Death' ? pick(DEATH_CAUSES) : '',
      sum_assured_inr: p.sum_assured_inr,
      claim_amount_inr: round2(Number(p.sum_assured_inr) * (ctype === 'Surrender' ? 0.35 + rnd() * 0.3 : 1)).toFixed(2),
      contestability_flag: ctype === 'Death' && withinContestability ? 'within_contestability' : 'outside',
      status: weightedPick(CLAIM_STATUS),
      fnol_channel: pick(['Branch', 'Advisor', 'Call centre', 'Portal', 'Email']),
    });
  }
  return rows;
}

const DOC_TYPES = ['Death certificate', 'Hospital discharge summary', 'Medical records', 'Claim form', 'KYC proof', 'Bank mandate (NEFT)', 'Nominee ID', 'FIR copy', 'Post-mortem report'];
function genClaimDocs(claims) {
  const rows = [];
  for (let i = 1; i <= N_CLAIM_DOC; i++) {
    const c = pick(claims);
    const dt = pick(DOC_TYPES);
    rows.push({
      doc_id: 'DOC' + String(i).padStart(6, '0'),
      claim_id: c.claim_id,
      policy_no: c.policy_no,
      claimant_name: c.claimant_name,
      doc_type: dt,
      file_name: `${dt.replace(/[^A-Za-z]/g, '_')}_${c.claim_id}.pdf`,
      pages: randInt(1, 14),
      extracted_amount_inr: (randInt(20000, 1000000)).toFixed(2),
      completeness: weightedPick([['complete', 68], ['incomplete', 22], ['illegible', 10]]),
      discrepancy_flag: weightedPick([['none', 74], ['amount_mismatch', 10], ['name_mismatch', 9], ['date_mismatch', 7]]),
      received_at: fmtDateTime(daysAgo(randInt(0, 200))),
    });
  }
  return rows;
}

function genKyc() {
  const rows = [];
  for (let i = 1; i <= N_KYC; i++) {
    const pan = genPan();
    rows.push({
      kyc_id: 'KYC' + String(i).padStart(6, '0'),
      holder_name: name(),
      pan_masked: maskPan(pan),
      aadhaar_masked: maskAadhaar(),
      doc_type: pick(['PAN + Aadhaar', 'Passport', 'Voter ID', 'Driving licence']),
      status: weightedPick([['verified', 70], ['pending', 20], ['mismatch_flagged', 10]]),
      verified_date: fmtDate(daysAgo(randInt(0, 500))),
      city: pick(CITIES),
    });
  }
  return rows;
}

// pricing_rfq + rate_card + helpdesk + competitors — insurer-framed (group life pricing, policyholder helpdesk)
const SCHEME_TYPES = ['OYRT', 'Group Term Life', 'Group Gratuity', 'EDLI Top-up', 'Group Credit Life'];
const INDUSTRIES = ['IT/ITES', 'Manufacturing', 'BFSI', 'Pharma', 'Retail', 'Logistics', 'Telecom'];
const BROKERS = [['Marsh India', 'quotes@marsh.example'], ['Aon India', 'gb@aon.example'], ['Willis Towers Watson', 'india@wtw.example'], ['Prudent Insurance Brokers', 'group@prudentbrokers.example'], ['Anand Rathi Insurance', 'eb@anandrathi.example']];
function genRateCard() {
  const rows = [];
  const bands = ['18-30', '31-40', '41-50', '51-60'];
  const bandBase = { '18-30': 0.85, '31-40': 1.35, '41-50': 2.6, '51-60': 5.4 };
  for (const st of SCHEME_TYPES) {
    const stMult = st === 'OYRT' ? 1 : st === 'Group Term Life' ? 1.1 : st === 'Group Credit Life' ? 1.25 : 0.9;
    for (const band of bands) {
      rows.push({
        scheme_type: st, age_band: band,
        base_rate_per_mille: round2(bandBase[band] * stMult).toFixed(4),
        loading_industry_pct: round2(5 + rnd() * 20).toFixed(2),
        min_group_size: st === 'OYRT' ? 10 : 25,
        approval_threshold_inr: (10000000).toFixed(2),
        effective_from: '2026-04-01', effective_to: '2027-03-31',
      });
    }
  }
  return rows;
}
function genRfq() {
  const rows = [];
  for (let i = 1; i <= N_RFQ; i++) {
    const [bn, be] = pick(BROKERS);
    const st = weightedPick([['OYRT', 55], ['Group Term Life', 20], ['Group Gratuity', 10], ['EDLI Top-up', 8], ['Group Credit Life', 7]]);
    const members = randInt(15, 5000);
    const complete = weightedPick([['complete', 65], ['incomplete', 35]]);
    rows.push({
      rfq_id: `RFQ-${fmtDate(daysAgo(randInt(0, 60))).replace(/-/g, '')}-${String(i).padStart(4, '0')}`,
      received_at: fmtDateTime(daysAgo(randInt(0, 60))),
      broker_name: bn, broker_email: be,
      scheme_name: `${pick(INDUSTRIES)} ${st} Scheme`, scheme_type: st,
      sum_assured_inr: (members * pick([500000, 1000000, 1500000, 2500000])).toFixed(2),
      member_count: members, avg_age: round2(28 + rnd() * 20).toFixed(1),
      male_pct: round2(45 + rnd() * 40).toFixed(1), industry: pick(INDUSTRIES),
      policy_term_years: 1, requested_effective_date: fmtDate(daysAgo(-randInt(7, 45))),
      completeness: complete,
      missing_fields: complete === 'complete' ? '' : pick(['member census age split', 'prior claims experience', 'occupation classification', 'sum assured per member']),
      status: weightedPick([['new', 40], ['priced', 35], ['awaiting_info', 15], ['approved', 10]]),
    });
  }
  return rows;
}
const HELPDESK_CATS = ['Policy servicing', 'Premium payment', 'Fund switch', 'Surrender request', 'Nominee change', 'Address update', 'Claim status', 'Maturity payout', 'Grievance', 'Document request'];
const ZONES = ['North', 'South', 'East', 'West', 'Central'];
function genHelpdesk() {
  const rows = [];
  for (let i = 1; i <= N_HELPDESK; i++) {
    const cat = pick(HELPDESK_CATS);
    const created = daysAgo(randInt(0, 45) + rnd());
    const priority = weightedPick([['low', 30], ['medium', 45], ['high', 20], ['urgent', 5]]);
    const slaHours = priority === 'urgent' ? 4 : priority === 'high' ? 24 : priority === 'medium' ? 48 : 72;
    const req = name();
    rows.push({
      case_id: `PSHD-${String(i).padStart(6, '0')}`, created_at: fmtDateTime(created),
      channel: weightedPick([['email', 80], ['portal', 15], ['phone', 5]]),
      requester_name: req, requester_email: req.toLowerCase().replace(/[^a-z]/g, '.') + '@gmail.example',
      policy_no: 'SL' + randDigits(10), subject: `${cat} request`,
      body: `Dear Suraksha Life PS Helpdesk, I need help with a ${cat.toLowerCase()}. My policy number is SL${randDigits(10)}. Regards, ${req}.`,
      category: cat, priority,
      status: weightedPick([['new', 25], ['in_progress', 30], ['awaiting_customer', 15], ['resolved', 25], ['escalated', 5]]),
      sla_due_at: fmtDateTime(new Date(created.getTime() + slaHours * 3600000)),
      assigned_zone: pick(ZONES), linked_crm_id: rnd() < 0.7 ? '500' + randDigits(15) : '',
    });
  }
  return rows;
}
const COMPETITORS = ['HDFC Life', 'ICICI Prudential', 'SBI Life', 'Max Life', 'Bajaj Allianz', 'Tata AIA', 'LIC', 'PNB MetLife'];
const PROD_CATS = ['Term Life', 'ULIP', 'Endowment', 'Annuity/Pension', 'Guaranteed Return', 'Child Plan'];
const FEATURES = ['Higher maturity bonus', 'Lower premium for 30-40 age band', 'Waiver of premium rider bundled', 'Return of premium option', 'Zero-cost term variant', 'Faster claim settlement SLA', 'Reduced surrender charges', 'Wellness-linked discount'];
const OUR_PRODUCTS = ['Suraksha Term Shield', 'Suraksha Wealth ULIP', 'Suraksha Guaranteed Endowment', 'Suraksha Pension Plus', 'Suraksha Shishu Child Plan'];
function genCompetitors() {
  const rows = [];
  for (let i = 1; i <= N_COMPETITOR; i++) {
    const comp = pick(COMPETITORS);
    const cat = pick(PROD_CATS);
    const idx = round2(85 + rnd() * 35);
    rows.push({
      intel_id: `CI-${String(i).padStart(5, '0')}`, competitor: comp,
      product_name: `${comp.split(' ')[0]} ${cat} ${pick(['Pro', 'Plus', 'Elite', 'Smart', 'Secure', 'Max'])}`,
      category: cat, premium_indexed: idx.toFixed(2), key_feature: pick(FEATURES),
      change_summary: `${comp} ${pick(['launched', 'repriced', 'revised', 'relaunched'])} its ${cat} plan — ${pick(FEATURES).toLowerCase()}.`,
      our_equivalent: pick(OUR_PRODUCTS), gap_flag: idx < 95 ? 'price_undercut' : idx > 110 ? 'we_cheaper' : weightedPick([['feature_gap', 40], ['at_par', 60]]),
      source_url: `https://www.${comp.split(' ')[0].toLowerCase()}.example/products/${cat.toLowerCase().replace(/[^a-z]/g, '-')}`,
      observed_at: fmtDate(daysAgo(randInt(0, 120))),
    });
  }
  return rows;
}

// ---- MySQL: advisors (agency force), employee_quota (reimbursement), job_requisitions, candidates
const ADVISOR_STATUS = [['active', 78], ['dormant', 14], ['terminated', 8]];
function genAdvisors() {
  const rows = [];
  for (let i = 1; i <= N_ADVISOR; i++) {
    rows.push({
      advisor_code: 'ADV' + String(i).padStart(6, '0'), full_name: name(),
      license_no: 'IRDAI-' + randDigits(8), region: pick(ZONES), city: pick(CITIES),
      persistency_13m_pct: round2(55 + rnd() * 40).toFixed(2),
      persistency_61m_pct: round2(35 + rnd() * 45).toFixed(2),
      policies_sold_ytd: randInt(0, 220), gwp_ytd_inr: (randInt(0, 500) * 100000).toFixed(2),
      status: weightedPick(ADVISOR_STATUS), onboarded_at: fmtDate(daysAgo(randInt(30, 3000))),
    });
  }
  return rows;
}
const DEPARTMENTS = ['Actuarial', 'Claims', 'Central Operations', 'Human Resources', 'Product', 'Sales', 'Finance', 'Risk & Compliance', 'Marketing'];
const GRADE_QUOTA = { G1: 40000, G2: 75000, G3: 120000, M1: 200000, M2: 350000, L1: 600000 };
const GRADES = Object.keys(GRADE_QUOTA);
function genEmployeeQuota() {
  const rows = [];
  const managers = [];
  for (let i = 1; i <= 40; i++) managers.push({ id: `EMP${String(i).padStart(5, '0')}`, name: name() });
  for (let i = 1; i <= N_EMPLOYEE; i++) {
    const grade = weightedPick([['G1', 30], ['G2', 28], ['G3', 20], ['M1', 12], ['M2', 7], ['L1', 3]]);
    const quota = GRADE_QUOTA[grade];
    const used = Math.min(round2(quota * weightedPick([[0.1, 20], [0.35, 30], [0.6, 25], [0.85, 15], [1.05, 10]])), round2(quota * 1.2));
    const mgr = i <= 40 ? managers[randInt(0, 4)] : pick(managers);
    rows.push({
      employee_id: `EMP${String(i).padStart(5, '0')}`, full_name: name(), pan: genPan(),
      department: pick(DEPARTMENTS), grade, reimbursement_quota_inr: quota.toFixed(2),
      quota_used_inr: used.toFixed(2), quota_remaining_inr: round2(quota - used).toFixed(2),
      fiscal_year: 'FY2026-27', manager_id: mgr.id, manager_name: mgr.name,
      status: weightedPick([['active', 94], ['on_leave', 4], ['exited', 2]]),
    });
  }
  return rows;
}
const REQ_DEFS = [
  ['Actuarial Analyst', 'Actuarial', 'IFoA exams, Group pricing, Excel modelling', 'R, Python, Prophet'],
  ['Claims Underwriter', 'Claims', 'Medical underwriting, Health claims, IRDAI norms', 'NOVA, MAXIS'],
  ['Relationship Manager', 'Sales', 'Life insurance sales, HNI relationships', 'Salesforce, Regional language'],
  ['Compliance Officer', 'Risk & Compliance', 'IRDAI reporting, AML/KYC', 'OpenSearch, Audit'],
  ['HR Business Partner', 'Human Resources', 'Talent acquisition, Employee relations', 'Workday, SAP HR'],
  ['Product Manager', 'Product', 'Insurance product design, Competitive analysis', 'ULIP, Annuities'],
  ['Ops Executive', 'Central Operations', 'Policy servicing, Ingenium', 'Excel, IDOC'],
  ['Actuarial Manager', 'Actuarial', 'Reserving, Pricing sign-off, IFoA qualified', 'Prophet, Python'],
];
const EMPLOYERS = ['HDFC Life', 'ICICI Prudential', 'SBI Life', 'Max Life', 'Bajaj Allianz', 'Tata AIA', 'LIC', 'Kotak Life', 'PNB MetLife', 'Reliance Nippon Life'];
const DEGREES = ['B.Com', 'B.Tech CSE', 'MBA Finance', 'M.Sc Statistics', 'B.Sc Actuarial', 'CA', 'MCA'];
function genReqs() {
  return REQ_DEFS.map(([title, dept, must, good], i) => ({
    req_id: `REQ-${String(i + 1).padStart(4, '0')}`, title, department: dept, location: pick(CITIES),
    grade: pick(GRADES), min_experience_years: randInt(1, 8), must_have_skills: must, good_to_have_skills: good,
    openings: randInt(1, 4), status: weightedPick([['open', 75], ['on_hold', 15], ['closed', 10]]),
    opened_at: fmtDate(daysAgo(randInt(5, 90))),
  }));
}
function genCandidates(reqs) {
  const rows = [];
  let cid = 1;
  for (const req of reqs) {
    const n = randInt(N_CAND_PER_REQ[0], N_CAND_PER_REQ[1]);
    const must = req.must_have_skills.split(', ');
    for (let k = 0; k < n; k++) {
      const exp = round2(Math.max(0.5, req.min_experience_years - 2 + rnd() * 8));
      const nm = name();
      const matched = must.filter(() => rnd() < 0.6);
      const skills = [...matched, ...pick([['Communication'], ['Leadership'], ['Stakeholder mgmt'], []])].join(', ');
      const score = round2(Math.min(100, 100 * (0.6 * (matched.length / Math.max(1, must.length)) + 0.4 * (exp >= req.min_experience_years ? 1 : exp / Math.max(1, req.min_experience_years))) + (rnd() * 8 - 4)));
      rows.push({
        candidate_id: `CAND-${String(cid++).padStart(6, '0')}`, req_id: req.req_id, full_name: nm,
        email: nm.toLowerCase().replace(/[^a-z]/g, '.') + '@mail.example', phone: '+91' + randDigits(10),
        city: pick(CITIES), total_experience_years: exp.toFixed(1), current_employer: pick(EMPLOYERS),
        current_designation: req.title.replace('Senior ', ''), skills, education: pick(DEGREES),
        expected_ctc_inr: (randInt(6, 45) * 100000).toFixed(2), notice_period_days: pick([0, 15, 30, 60, 90]),
        resume_summary: `${exp} yrs in ${req.department}; skills: ${skills}; last at ${pick(EMPLOYERS)}.`,
        match_score: score.toFixed(2), shortlist_status: score >= 70 ? 'shortlisted' : score >= 50 ? 'review' : 'rejected',
        received_at: fmtDateTime(daysAgo(randInt(0, 30))),
      });
    }
  }
  return rows;
}

// ================================================================== Postgres
async function seedPostgres(data) {
  const { Client, Pool } = await import('pg');
  // 1) create the isolated DB (CREATE DATABASE can't run in a txn / needs an existing DB to connect to).
  const admin = new Client({ host: DS_HOST, port: PG_PORT, user: PG_USER, password: PG_PASS, database: PG_ADMIN_DB, connectionTimeoutMillis: 8000 });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [SURAKSHA_DB]);
    if (!rows.length) {
      await admin.query(`CREATE DATABASE ${SURAKSHA_DB}`);
      console.log(`  created Postgres database ${SURAKSHA_DB}`);
    } else {
      console.log(`  Postgres database ${SURAKSHA_DB} already exists`);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
  // 2) DDL + load into the isolated DB.
  const pool = new Pool({ host: DS_HOST, port: PG_PORT, user: PG_USER, password: PG_PASS, database: SURAKSHA_DB, connectionTimeoutMillis: 8000, max: 3 });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS policies (
      policy_no text PRIMARY KEY, holder_name text, pan text, plan_type text, sum_assured_inr numeric(18,2),
      annual_premium_inr numeric(14,2), premium_mode text, status text, issue_date date, maturity_date date,
      nominee_name text, city text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS premiums (
      premium_id text PRIMARY KEY, policy_no text, amount_inr numeric(14,2), due_date date, paid_date date, mode text, status text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS claims (
      claim_id text PRIMARY KEY, policy_no text, claimant_name text, claim_type text, intimated_date date,
      cause_of_death text, sum_assured_inr numeric(18,2), claim_amount_inr numeric(18,2), contestability_flag text,
      status text, fnol_channel text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS claim_documents (
      doc_id text PRIMARY KEY, claim_id text, policy_no text, claimant_name text, doc_type text, file_name text,
      pages int, extracted_amount_inr numeric(18,2), completeness text, discrepancy_flag text, received_at timestamptz)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS kyc_documents (
      kyc_id text PRIMARY KEY, holder_name text, pan_masked text, aadhaar_masked text, doc_type text, status text,
      verified_date date, city text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS pricing_rate_card (
      scheme_type text, age_band text, base_rate_per_mille numeric(8,4), loading_industry_pct numeric(6,2),
      min_group_size int, approval_threshold_inr numeric(18,2), effective_from date, effective_to date)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS pricing_rfq (
      rfq_id text PRIMARY KEY, received_at timestamptz, broker_name text, broker_email text, scheme_name text,
      scheme_type text, sum_assured_inr numeric(18,2), member_count int, avg_age numeric(5,1), male_pct numeric(5,1),
      industry text, policy_term_years int, requested_effective_date date, completeness text, missing_fields text, status text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS helpdesk_cases (
      case_id text PRIMARY KEY, created_at timestamptz, channel text, requester_name text, requester_email text,
      policy_no text, subject text, body text, category text, priority text, status text, sla_due_at timestamptz,
      assigned_zone text, linked_crm_id text)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS competitor_products (
      intel_id text PRIMARY KEY, competitor text, product_name text, category text, premium_indexed numeric(6,2),
      key_feature text, change_summary text, our_equivalent text, gap_flag text, source_url text, observed_at date)`);

    await bulkPg(pool, 'policies', data.policies);
    await bulkPg(pool, 'premiums', data.premiums);
    await bulkPg(pool, 'claims', data.claims);
    await bulkPg(pool, 'claim_documents', data.claimDocs);
    await bulkPg(pool, 'kyc_documents', data.kyc);
    await bulkPg(pool, 'pricing_rate_card', data.rateCard);
    await bulkPg(pool, 'pricing_rfq', data.rfq);
    await bulkPg(pool, 'helpdesk_cases', data.helpdesk);
    await bulkPg(pool, 'competitor_products', data.competitors);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
async function bulkPg(pool, table, rows) {
  await pool.query(`TRUNCATE TABLE ${table}`);
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const CH = 500;
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH);
    const values = []; const params = []; let p = 1;
    for (const r of chunk) {
      values.push(`(${cols.map(() => `$${p++}`).join(',')})`);
      for (const c of cols) params.push(r[c]);
    }
    await pool.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${values.join(',')}`, params);
  }
  process.stdout.write(`  ${SURAKSHA_DB}(pg).${table}: ${rows.length}\n`);
}

// ================================================================== MySQL
async function seedMysql(data) {
  const mysql = (await import('mysql2/promise')).default;
  // 1) create schema (connect without a database).
  const admin = await mysql.createConnection({ host: DS_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASS, connectTimeout: 8000 });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${SURAKSHA_DB}\` CHARACTER SET utf8mb4`);
    console.log(`  ensured MySQL schema ${SURAKSHA_DB}`);
  } finally {
    await admin.end().catch(() => undefined);
  }
  // 2) DDL + load.
  const conn = await mysql.createConnection({ host: DS_HOST, port: MYSQL_PORT, user: MYSQL_USER, password: MYSQL_PASS, database: SURAKSHA_DB, connectTimeout: 8000, multipleStatements: true });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS advisors (
      advisor_code varchar(16) PRIMARY KEY, full_name varchar(80), license_no varchar(24), region varchar(16), city varchar(40),
      persistency_13m_pct decimal(5,2), persistency_61m_pct decimal(5,2), policies_sold_ytd int, gwp_ytd_inr decimal(16,2),
      status varchar(16), onboarded_at date)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS employee_quota (
      employee_id varchar(16) PRIMARY KEY, full_name varchar(80), pan varchar(12), department varchar(40), grade varchar(8),
      reimbursement_quota_inr decimal(12,2), quota_used_inr decimal(12,2), quota_remaining_inr decimal(12,2),
      fiscal_year varchar(12), manager_id varchar(16), manager_name varchar(80), status varchar(16))`);
    await conn.query(`CREATE TABLE IF NOT EXISTS job_requisitions (
      req_id varchar(16) PRIMARY KEY, title varchar(80), department varchar(40), location varchar(40), grade varchar(8),
      min_experience_years int, must_have_skills text, good_to_have_skills text, openings int, status varchar(16), opened_at date)`);
    await conn.query(`CREATE TABLE IF NOT EXISTS candidates (
      candidate_id varchar(16) PRIMARY KEY, req_id varchar(16), full_name varchar(80), email varchar(120), phone varchar(20),
      city varchar(40), total_experience_years decimal(4,1), current_employer varchar(80), current_designation varchar(80),
      skills text, education varchar(40), expected_ctc_inr decimal(12,2), notice_period_days int, resume_summary text,
      match_score decimal(5,2), shortlist_status varchar(16), received_at datetime)`);
    await bulkMysql(conn, 'advisors', data.advisors);
    await bulkMysql(conn, 'employee_quota', data.employeeQuota);
    await bulkMysql(conn, 'job_requisitions', data.reqs);
    await bulkMysql(conn, 'candidates', data.candidates);
  } finally {
    await conn.end().catch(() => undefined);
  }
}
async function bulkMysql(conn, table, rows) {
  await conn.query(`TRUNCATE TABLE \`${table}\``);
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const CH = 500;
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH);
    const params = chunk.map((r) => cols.map((c) => r[c]));
    await conn.query(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES ?`, [params]);
  }
  process.stdout.write(`  ${SURAKSHA_DB}(mysql).${table}: ${rows.length}\n`);
}

// ================================================================== main
async function main() {
  console.log(`Suraksha Life data-plane seed → PG ${DS_HOST}:${PG_PORT}/${SURAKSHA_DB} · MySQL ${DS_HOST}:${MYSQL_PORT}/${SURAKSHA_DB}`);
  console.log('Generating deterministic life-insurer data ...');
  const policies = genPolicies();
  const premiums = genPremiums(policies);
  const claims = genClaims(policies);
  const claimDocs = genClaimDocs(claims);
  const kyc = genKyc();
  const rateCard = genRateCard();
  const rfq = genRfq();
  const helpdesk = genHelpdesk();
  const competitors = genCompetitors();
  const advisors = genAdvisors();
  const employeeQuota = genEmployeeQuota();
  const reqs = genReqs();
  const candidates = genCandidates(reqs);

  console.log('Seeding Postgres (core insurance book) ...');
  await seedPostgres({ policies, premiums, claims, claimDocs, kyc, rateCard, rfq, helpdesk, competitors });
  console.log('Seeding MySQL (advisors / HR / reimbursement) ...');
  await seedMysql({ advisors, employeeQuota, reqs, candidates });

  console.log('\nAll Suraksha Life source tables loaded. Per-first-use-case data check:');
  console.log(`  #1 Reimbursement  → mysql ${SURAKSHA_DB}.employee_quota      : ${employeeQuota.length}`);
  console.log(`  #13 Competitor    → pg ${SURAKSHA_DB}.competitor_products    : ${competitors.length}`);
  console.log(`  #7 CV screening   → mysql ${SURAKSHA_DB}.candidates/${'job_requisitions'} : ${candidates.length}/${reqs.length}`);
  console.log(`  #2 Pricing        → pg ${SURAKSHA_DB}.pricing_rfq/rate_card  : ${rfq.length}/${rateCard.length}`);
  console.log(`  #3 Helpdesk       → pg ${SURAKSHA_DB}.helpdesk_cases         : ${helpdesk.length}`);
  console.log(`  core book         → pg policies/premiums/claims/claim_docs/kyc : ${policies.length}/${premiums.length}/${claims.length}/${claimDocs.length}/${kyc.length}`);
  console.log(`  distribution      → mysql ${SURAKSHA_DB}.advisors             : ${advisors.length}`);
}

main().catch((e) => { console.error('\n' + (e && e.stack || e)); process.exit(1); });
