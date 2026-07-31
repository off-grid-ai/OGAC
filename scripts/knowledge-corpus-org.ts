// ─── Real text for the ORG knowledge collections ───────────────────────────────────────────────────
//
// LIVE FINDING (2026-07-31). 24 of the 37 documents in the org collections had **zero indexed chunks**.
// The collection pages listed them, the doc count looked healthy, and nothing in the product said the
// text was never indexed — so a reviewer would see "6 documents" on "KYC & AML Policies" while retrieval
// could return nothing from any of them. That is the failure-presenting-as-emptiness class again, one
// layer down: an unindexed document is invisible to retrieval but visible in the list.
//
// Keyed by the exact document name in `org_knowledge_docs`. Applied by scripts/reindex-knowledge.mts
// through the product's own chunk→embed path, so citations from these collections are real.

export const ORG_DOCS: Record<string, string> = {
  // ── Bharat Union Co-operative Bank · HR & Reimbursement ──────────────────────────────────────────
  'Employee Reimbursement Policy.pdf': `EMPLOYEE REIMBURSEMENT POLICY
Bharat Union Co-operative Bank · People & Finance · Version 6.0 · Effective 01 April 2025

Purpose. To reimburse expenses incurred wholly and necessarily for the Bank's business, with a single
standard for evidence, limits and approval.

Claim window. 30 days from the expense date. 31-60 days requires the function head's written approval.
Beyond 60 days the claim is rejected; only the CFO may make an exception.

Evidence. A GST-compliant invoice showing the vendor's GSTIN, amount and date is required for every line.
Claims of ₹5,000 and above additionally require the digital payment reference (UPI, NEFT or card). Cash
payments above ₹5,000 are not reimbursable. Local conveyance up to ₹500 a day may be self-declared.

Category limits. Local conveyance ₹1,500 a day. Hotel ₹6,000 a night in metros and ₹4,000 elsewhere.
Meals on tour ₹1,200 a day in metros, ₹800 elsewhere. Client entertainment ₹2,500 an occasion with the
business purpose and attendees recorded. Mobile and data ₹1,000 a month for grade M3 and above.

Approvals. Up to ₹10,000 the reporting manager. ₹10,001-₹50,000 the reporting manager and function head.
Above ₹50,000 the function head and the Finance Controller. A claim by an employee on their own reporting
line is approved one level up.

Prohibited. Alcohol, personal shopping, traffic fines, loss of personal property, family travel, any
payment to a public official, and any expense already settled on a Bank corporate card.

Payment. With the next payroll cycle, or within 10 working days where the claim exceeds ₹1,00,000. A
duplicated or unsupported claim is recovered from salary after notice; a second instance is a
disciplinary matter.`,

  'Expense Approval Authority Limits.md': `EXPENSE APPROVAL AUTHORITY LIMITS
Finance · Delegation of Authority · Version 3.1 · Effective 01 April 2026

Employee expense claims. Up to ₹10,000 reporting manager · ₹10,001-₹50,000 function head ·
₹50,001-₹2,00,000 Finance Controller · above ₹2,00,000 Chief Financial Officer.

Vendor invoices against a purchase order. Up to ₹1,00,000 department head · ₹1,00,001-₹10,00,000 Finance
Controller · ₹10,00,001-₹50,00,000 CFO · above ₹50,00,000 the Managing Director, with the Board's
approval where the commitment exceeds one financial year.

Without a purchase order (emergency purchase). Up to ₹50,000 only, department head plus Finance
Controller, regularised with a post-facto PO within 7 days. Repeat use by the same department in a
quarter is reported to the Audit Committee.

Quota overage on a reimbursement category. Up to 20% function head · above 20% Finance Controller ·
above 50% Finance Controller with a written business case, listed in the monthly exceptions pack.

Write-off of an unrecoverable advance. Up to ₹25,000 Finance Controller · ₹25,001-₹2,00,000 CFO · above
₹2,00,000 the Audit Committee.

Segregation rules. No person approves a payment to themselves, to a relative, or to an entity in which
they hold an interest. No person both creates and approves a vendor master record. Approval limits are
personal and may be delegated only in writing, for a stated period, to a named alternate of the same
grade or above.

Control. The delegation matrix is reconciled to the ERP approval configuration each quarter; a
configuration that exceeds this matrix is a reportable control failure.`,

  'Travel Grade & Per-Diem Matrix.xlsx': `TRAVEL GRADE AND PER-DIEM MATRIX — FY 2025-26
Finance · Companion to the Employee Reimbursement Policy

Air travel entitlement. Grades M1-M2: not entitled, rail AC 2-tier. M3-M4: economy class, lowest logical
fare, booked at least 7 days ahead. M5-M6: economy class, any fare. M7 and above: economy, with business
class permitted for a single flight leg longer than 6 hours on the Managing Director's approval.

Rail entitlement. M1-M2 AC 3-tier · M3-M4 AC 2-tier · M5 and above AC first class or executive chair car.

Road. Own vehicle at ₹12 per km for a car and ₹4 per km for a two-wheeler, on a self-declared log
showing origin, destination and purpose. Taxi at actuals within the daily conveyance cap.

Hotel ceiling per night. Metro (Mumbai, Delhi NCR, Bengaluru, Chennai, Kolkata, Hyderabad, Pune):
M1-M2 ₹3,500 · M3-M4 ₹6,000 · M5-M6 ₹9,000 · M7+ ₹12,000.
Non-metro: M1-M2 ₹2,500 · M3-M4 ₹4,000 · M5-M6 ₹6,000 · M7+ ₹8,000.

Per-diem (covers meals and incidentals; no invoice required). Metro: M1-M2 ₹800 · M3-M4 ₹1,200 ·
M5-M6 ₹1,800 · M7+ ₹2,500. Non-metro: M1-M2 ₹600 · M3-M4 ₹800 · M5-M6 ₹1,200 · M7+ ₹1,800.
Per-diem is halved where the Bank or a host pays for meals, and is not payable for a day trip returning
within 8 hours.

Booking discipline. All travel is booked through the empanelled travel desk. A self-booking is reimbursed
at the lower of actual and the fare the desk would have offered. Cancellation charges are reimbursed only
where the trip was cancelled for a business reason recorded by the function head.`,

  // ── Bharat Union · KYC & AML ─────────────────────────────────────────────────────────────────────
  'AML-CFT Policy 2026.pdf': `ANTI-MONEY-LAUNDERING AND COUNTERING THE FINANCING OF TERRORISM POLICY
Compliance · Version 8.0 · Effective 01 April 2026 · Board-approved

1. Governance. The Principal Officer owns this policy and reports to the Audit Committee quarterly. The
Designated Director is the Managing Director. Every employee completes AML training annually; a branch
cannot open accounts if its training compliance falls below 95%.

2. Customer risk categorisation. Every customer is categorised high, medium or low at onboarding and on
every re-KYC, using occupation, product mix, geography, transaction pattern and PEP status. High-risk
customers require senior management approval to onboard and are reviewed every two years.

3. Thresholds and reporting. Cash Transaction Reports are filed for cash deposits or withdrawals
aggregating above ₹10,00,000 in a month. Suspicious Transaction Reports are raised on structuring,
transactions inconsistent with the declared profile, rapid movement of funds, or refusal to explain the
source. Counterfeit Currency Reports are filed on detection. Cross-border wire transfers above
₹5,00,000 require full originator and beneficiary information.

4. Enhanced due diligence. Required for PEPs and their relatives and close associates, for non-face-to-
face onboarding, for customers from high-risk jurisdictions, and for any relationship where beneficial
ownership is unclear. EDD includes source of funds, source of wealth and senior approval.

5. Prohibited relationships. Shell entities with no verifiable business, bearer-share companies,
customers who refuse to identify a beneficial owner, and any person on the UNSC sanctions list.

6. Alert handling. An alert is dispositioned within 7 working days; an STR decision within 15 days of
the alert. Every disposition records the analyst, the evidence reviewed and the rationale. Tipping off a
customer about an STR is a criminal offence and a summary dismissal matter.

7. Records. KYC records are retained for 5 years after the relationship ends; transaction records for 5
years from the transaction; STR-related records for 5 years from the filing.`,

  'KYC Master Direction (RBI) v3.2.pdf': `KNOW YOUR CUSTOMER — POLICY ALIGNED TO THE RBI MASTER DIRECTION
Compliance · Version 3.2

1. The four elements. Customer acceptance policy, customer identification procedures, monitoring of
transactions, and risk management. No account is opened on an anonymous or fictitious name, and no
account is opened where the Bank cannot verify identity and address.

2. Customer identification. Identity and current address are verified from an Officially Valid Document.
Accepted OVDs: passport, driving licence, voter's identity card, NREGA job card signed by a State
Government officer, National Population Register letter, and proof of possession of Aadhaar subject to
mandatory masking of the first eight digits. PAN or Form 60 is obtained in every case.

3. Video-based Customer Identification (V-CIP). Permitted for onboarding and re-KYC. The official
initiates the call from a domain-controlled application, captures a live photograph, verifies the OVD on
screen, confirms geo-location within India, asks random questions to establish liveness, and retains the
recording for 10 years.

4. Beneficial ownership. For a company, any natural person holding more than 10% of shares or exercising
control. For a partnership or trust, more than 10% of capital, profits or beneficial interest. Where no
natural person is identified, the senior managing official is recorded.

5. Periodic updation. High risk every 2 years, medium risk every 8 years, low risk every 10 years. A
self-declaration suffices where there is no change; a declared change of address is verified within two
months.

6. Restriction for non-compliance. Notices at 90, 60 and 30 days before the due date, then partial freeze
after a further 30-day notice, then full freeze only after six months with the Principal Officer's
approval. Pension accounts and customers above 70 are reviewed manually before any restriction.

7. Prohibitions. No OVD original is retained. The full Aadhaar number is never stored. Service is never
refused for declining a digital channel where an assisted branch route exists.`,

  'PEP & Sanctions Screening SOP.md': `POLITICALLY EXPOSED PERSON AND SANCTIONS SCREENING SOP
Compliance · Financial Crime Operations · Version 4.3

1. When screening runs. At onboarding, before the first transaction; on every re-KYC; on every change of
name, address or beneficial owner; nightly against list updates for the entire customer base; and in real
time on every cross-border payment for originator and beneficiary.

2. Lists screened. UNSC consolidated list, the Ministry of Home Affairs UAPA list, the RBI caution list,
the domestic and international PEP lists maintained by the screening vendor, and adverse-media matches
scored by the vendor.

3. Match handling. A hit is graded within 24 hours: true match, potential match, or false positive.
A true match against a sanctions list means no account, no transaction, immediate freeze of any existing
relationship, and reporting to the Financial Intelligence Unit and the RBI the same working day.
A potential match is escalated to the Principal Officer with the identifiers compared — name, date of
birth, nationality, passport or PAN — and a decision recorded within 3 working days.
A false positive is closed with the discriminating identifier stated. "Name differs" alone is not a
sufficient reason.

4. PEP relationships. Permitted only with senior management approval, with source of funds and source of
wealth documented, an enhanced transaction-monitoring profile, and annual review. The PEP status of a
customer's spouse, children, parents and close associates is recorded.

5. Prohibited conduct. Never inform a customer that they matched a sanctions or PEP list. Never override
a hit without the recorded approval of the Principal Officer. Never clear a hit in bulk.

6. Quality control. 10% of closed false positives are re-reviewed monthly by a second analyst. Screening
coverage — the proportion of the customer base screened against the latest list version — is reported
weekly and may not fall below 99.5%.`,

  'Periodic Re-KYC Cadence.md': `PERIODIC RE-KYC CADENCE AND OPERATIONS
Compliance · Version 5.2

Cadence. High risk 2 years, medium risk 8 years, low risk 10 years, counted from the last full
verification recorded on the customer master.

Work queue. The re-KYC due list is generated on the first working day of each month for the following
120 days and allocated to branches by customer segment. A branch's queue age is reported weekly; nothing
may sit unactioned beyond 30 days.

Customer contact. Three notices — 90, 60 and 30 days before the due date — on the registered mobile and
email, in the customer's registered language. Each notice states exactly what is needed and the channels
available, including the assisted branch route.

Accepted completion routes. Self-declaration of no change through branch, ATM, net banking, mobile
banking, registered email or letter. Declared change of address, verified within two months. V-CIP.
Branch-assisted re-KYC with OVD verification.

Restriction ladder. Overdue → written 30-day notice → partial freeze (credits allowed, debits
restricted) → after six months and the Principal Officer's approval, full freeze. Pension accounts,
accounts of customers above 70, and accounts of persons with disability are reviewed manually before any
restriction is applied.

Data captured on completion. Documents seen, verifier's employee id, screening result on the date of
review, occupation and income band confirmed, and the risk category assigned after review.

Reporting. Overdue re-KYC by branch and risk category monthly to the Principal Officer, quarterly to the
Audit Committee. A branch above 5% overdue in its due cohort is placed on a corrective plan.`,

  // ── Bharat Union · Lending & Underwriting ────────────────────────────────────────────────────────
  'CIBIL Score Cutoff Matrix.md': `CREDIT BUREAU SCORE CUTOFF MATRIX
Credit · Retail Assets · Version 3.0 · Effective 01 April 2026

Personal loan (unsecured). 760 and above: standard track, best pricing. 730-759: standard track.
700-729: one compensating factor required — salary account with the Bank for 12 months, or a closed loan
with zero delinquency, or a co-applicant scoring 760+. Below 700: decline; deviation only by the Regional
Credit Head and capped at 5% of monthly sanction count.

Two-wheeler loan. 700 and above standard. 650-699 permitted at 10% lower loan-to-value. Below 650
decline. First-time borrower with no score (-1) permitted up to ₹1,00,000 with income proof.

Loan against property. 700 and above standard. 660-699 permitted with LTV reduced by 10 points.
Below 660 referred to the Credit Committee.

Gold loan. Score not used; sanction rests on ownership and assay. A suit-filed or wilful-default record
is still a decline.

Hard declines at any score. Written-off or settled account in the last 36 months. Suit-filed or wilful
default, ever. More than three unsecured facilities live across lenders. Any 90+ DPD in the last 12
months. Enquiry count above 8 in the last 3 months, unless explained in writing.

Thin-file and no-hit cases. Where the bureau returns no record, income and banking behaviour govern:
six months' bank statement, employer on the approved list, and a maximum ticket of ₹3,00,000.

Governance. Cutoffs are reviewed half-yearly against 6-month-on-book delinquency. Any score band whose
30+ DPD exceeds 4% is tightened at the next review, and the change is documented for the Credit Committee.`,

  'FOIR & Income Assessment Policy.pdf': `FIXED OBLIGATION TO INCOME RATIO AND INCOME ASSESSMENT POLICY
Credit · Underwriting Standards · Version 3.5

Income recognised. Salaried — net monthly credited salary averaged over three months; variable pay at
50% and only where paid in each of the last four quarters. Self-employed — profit after tax plus
depreciation averaged over two assessment years; a year-on-year fall greater than 25% caps recognised
income at the lower year. Rental income at 70% of a registered lease with more than 12 months to run.
Agricultural income against a land record, capped at 40% of total income. Untraceable cash deposits are
never income.

Obligations counted. Every live EMI on the bureau report; 5% of the sanctioned limit on any card or
overdraft; the card minimum due where the card has revolved for three consecutive months; the proposed
EMI at the offered rate. Obligations closed within the last 30 days may be excluded on proof.

FOIR ceilings by net monthly income. Up to ₹40,000 — 40%. ₹40,001-₹75,000 — 50%. ₹75,001-₹2,00,000 —
55%. Above ₹2,00,000 — 60%. Secured facilities may go 5 points higher with the Regional Credit Head's
approval, recorded as a deviation.

Documents. Salaried: three months' slips, six months' salary-account statement, Form 16 or ITR
acknowledgement. Self-employed: two years' ITR with computation, GST returns for four quarters, 12
months' current-account statement, and proof of three years' business continuity.

Verification. Salary credits are matched to the employer named on the slip; a mismatch needs employer
confirmation before sanction. Documents are checked for tampering, and any suspicion goes to Fraud Risk
before a credit decision is recorded.`,

  'Personal Loan Underwriting Guidelines.pdf': `PERSONAL LOAN UNDERWRITING GUIDELINES
Credit · Retail Assets · Version 7.1

Product. Unsecured personal loan, ₹50,000 to ₹20,00,000, tenor 12-60 months, equated monthly
instalments, no prepayment penalty after 12 instalments.

Eligibility. Age 21 at application and not above 60 at maturity for salaried applicants, 65 for
self-employed. Minimum net monthly income ₹25,000 in metros and ₹18,000 elsewhere; minimum annual
business income ₹4,00,000 per the latest ITR. Twelve months' total work experience with six months in
the current organisation. Residence within the branch's service geography.

Decision inputs, in order. Bureau score and history against the cutoff matrix; FOIR including the
proposed EMI; employer category; banking behaviour (average balance, returned mandates, salary
regularity); and the declared purpose of the loan.

Pricing. Risk-based, from the published card rate, with a maximum discount of 100 basis points for a
score above 780 with a salary account. Processing fee up to 2% of the sanctioned amount plus GST.

Deviation authority. Up to ₹5,00,000 the Branch Credit Manager · ₹5,00,001-₹20,00,000 the Regional
Credit Head · any policy deviation, the Credit Committee. Every deviation records the compensating factor
and enters the monthly deviation pack.

Disbursal conditions. Sanction letter accepted; repayment mandate registered; insurance where applicable;
KYC current; and, for any loan above ₹10,00,000, a telephonic verification of employment recorded.

Post-sanction monitoring. First-instalment default triggers a same-day contact and a file review. Any
sourcing channel whose 6-month 30+ DPD exceeds 3% is suspended pending review.`,

  // ── Bharat Union · Motor Claims ──────────────────────────────────────────────────────────────────
  'Cashless Network Garage Rules.md': `CASHLESS NETWORK GARAGE RULES
Motor Claims · Provider Network · Version 3.4

Empanelment. A garage is empanelled on trade licence, GST registration, workshop photographs, equipment
list, technician count, and a signed tariff schedule. Empanelment is reviewed annually and on any
substantiated complaint.

Tariff discipline. The agreed labour rate for the city and the agreed paint-per-panel rate govern every
cashless claim. A garage billing above tariff is settled at tariff; the difference may not be recovered
from the customer. Repeated over-billing leads to de-panelment.

Customer obligations at the garage. The customer pays only the policy deductible, the depreciation on
parts as per the schedule, any non-payable items, and the cost of any repair not related to the claim,
agreed in writing beforehand.

Process. Vehicle received → claim number verified → survey scheduled or photographs uploaded → approved
estimate issued → repair begins only after approval → supplementary approval sought before any
additional work → delivery on payment of the customer's share → invoice and satisfaction note uploaded
within 48 hours of delivery.

Prohibited. Starting repair before survey approval; replacing a part that was repairable without written
approval; billing for a part not fitted; retaining the vehicle after the insurer's payment is released;
asking a customer for a cash deposit on an approved cashless claim.

Turnaround commitments. Estimate uploaded within 4 hours of vehicle receipt. Repair completion within 3
working days for minor damage, 7 for medium, and an agreed date for major damage. Delay beyond the
committed date is reported with a reason, and the customer is informed by the garage and the insurer.

Quality. Re-inspection is mandatory for claims above ₹1,00,000 and on 5% of all others. A repair failing
re-inspection is rectified at the garage's cost.`,

  'Motor FNOL Intake SOP.pdf': `MOTOR FIRST NOTICE OF LOSS — INTAKE SOP
Motor Claims · Version 4.1

Safety first. The first question on every call is whether anyone is injured. An injury makes the claim a
medico-legal case: the caller receives the emergency number, the location is confirmed, and a claims
officer calls back within 30 minutes.

Mandatory capture. Policy number and vehicle registration; date, time and place of loss with a landmark;
caller's name, mobile and relationship to the insured; the person driving at the time and their driving
licence number and validity; the incident in the caller's own words; whether a third party (person,
vehicle or property) is involved; whether police were informed and the FIR number; the vehicle's current
location and whether it is drivable; the preferred garage.

Never promised on the call. Admissibility, the amount payable, depreciation or salvage treatment, a
repair timeline, or "cashless" before confirming the garage is in network for that city.

Routing by band. Up to ₹25,000, drivable, no third party: photograph-based assessment, no surveyor.
₹25,001-₹1,00,000: surveyor allocated within 4 hours, spot survey within 24 hours. Above ₹1,00,000, or
suspected total loss, or theft, or third-party injury: senior surveyor within 2 hours, Claims Manager
notified, investigation file opened.

Theft and total loss. Theft requires the FIR, the registration certificate, both keys and the
non-traceable certificate before settlement. Total loss is settled on the Insured Declared Value less
retained salvage.

Closing. The claim number is read back and sent by SMS with the next step, and the caller is told not to
begin repairs before survey. Every call is logged with the fields captured and the advice given.`,

  'Salvage & Depreciation Schedule.xlsx': `SALVAGE AND DEPRECIATION SCHEDULE
Motor Claims · Assessment Standards · Version 3.8

Depreciation on parts by vehicle age. Up to 6 months nil · 6 months to 1 year 5% · 1-2 years 10% ·
2-3 years 15% · 3-4 years 25% · 4-5 years 35% · 5-10 years 40% · above 10 years 50%.

Flat-rate categories, regardless of age. Rubber, nylon and plastic parts, tyres, tubes and batteries 50%.
Fibreglass components 30%. Glass nil.

Labour and paint. Labour at the network tariff for the city. Painting assessed by panel count at the
agreed per-panel rate, not on invoice value. Denting assessed per panel with a maximum of two attempts
per panel.

Betterment. Deducted where a replacement leaves the vehicle in a better condition than before the loss —
for example a new assembly replacing a worn one, or an upgraded accessory.

Total loss test. Where assessed repair cost plus salvage recovery exceeds 75% of the Insured Declared
Value, the claim is settled as a constructive total loss.

Salvage disposal. Through the approved salvage-buyer panel, by sealed quotation, minimum three
quotations, highest accepted. Where the insured retains the salvage, the assessed salvage value is
deducted from the settlement and the retention is recorded in writing.

Documentation for each deduction. Every deduction on an assessment sheet cites either the policy clause
or the row of this schedule it comes from. An uncited deduction is reversed on audit.

Audit. Ten percent of assessments are audited monthly. Variance beyond 10% in either direction triggers a
surveyor review; a repeat pattern leads to de-panelment.`,

  'Surveyor Deployment Guidelines.pdf': `SURVEYOR DEPLOYMENT GUIDELINES
Motor Claims · Version 3.8

Licensing. Only surveyors holding a valid IRDAI licence for the class of business and within their
sanctioned monetary limit may be allocated. Licence expiry blocks allocation automatically; no manual
override exists for an expired licence.

Allocation. Automatic by pin code, then loss band, then availability. A manual override records a reason
code and is reported weekly. Allocation is refused where the surveyor, the garage, the insured or the
driver are related parties; the conflict declaration is part of acceptance.

Turnaround. Allocation within 2 hours in metros and 4 hours elsewhere. Spot survey within 24 hours.
Survey report within 72 hours of the survey. Any breach is escalated to the Claims Manager with a reason.

Spot survey content. Photographs of all four corners, every damaged panel in close-up, the odometer, the
chassis-number plate, the registration plate and the driver's licence. Verification of registration
against the RC, engine and chassis numbers, and the damage pattern against the reported cause of loss.
The driver's signed statement of the incident.

Report standard. Cause of loss; description of damage panel by panel; parts to replace with reason;
parts to repair; labour hours; depreciation applied with the schedule row cited; salvage assessment; and
a clear recommendation with the assessed liability.

Re-inspection. Mandatory after repair for claims above ₹1,00,000 and for every replaced airbag, plus a
5% random sample. A mismatch stops payment and opens an enquiry.

Fees and conduct. Fees are per the empanelment schedule; no surveyor may accept any payment or hospitality
from a garage or an insured. A substantiated conduct complaint is grounds for immediate de-panelment.`,

  // ── Bharat Union · Product & Pricing ─────────────────────────────────────────────────────────────
  'Debit & Credit Card Fee Schedule.pdf': `DEBIT AND CREDIT CARD FEE SCHEDULE
Cards & Payments · Effective 01 April 2026 · All fees exclusive of GST

Debit cards. Classic: issuance nil, annual fee ₹150 from the second year. Platinum: issuance ₹250,
annual fee ₹500. Business: issuance ₹500, annual fee ₹750.
Replacement card ₹200. PIN regeneration nil through digital channels, ₹50 at a branch.

ATM usage. Five free transactions a month at the Bank's own ATMs, then ₹21 a transaction. At other banks'
ATMs: three free transactions a month in the six metros and five elsewhere, then ₹21 a transaction.
Balance enquiry at other banks' ATMs counts as a non-financial transaction; two free a month.
Cash withdrawal declined for insufficient balance: ₹25.

Credit cards. Silver: joining ₹500, annual ₹500, waived on annual spend of ₹1,00,000. Gold: joining
₹1,500, annual ₹1,500, waived on annual spend of ₹3,00,000. Signature: joining ₹5,000, annual ₹5,000,
waived on annual spend of ₹10,00,000.
Finance charge 3.5% a month (42% a year) on the revolving balance. Late payment fee: nil below ₹500 due,
₹500 for ₹501-₹10,000, ₹800 for ₹10,001-₹25,000, ₹1,200 above ₹25,000.
Over-limit fee 2.5% of the over-limit amount, minimum ₹500, only where the customer has opted in.
Cash advance 2.5% of the amount, minimum ₹500, with finance charge from the transaction date.
Foreign currency mark-up 3.5%. Dynamic currency conversion mark-up 1% additional.
EMI conversion: processing fee ₹199, interest as per the tenor grid disclosed at conversion.

Statement and disclosure. The minimum amount due, the interest that would accrue if only the minimum is
paid, and the free-credit-period rules are printed on every statement. No fee is levied that is not on
this schedule.`,

  'Fixed Deposit Interest Rate Card.pdf': `FIXED DEPOSIT INTEREST RATE CARD
Treasury & Liabilities · Effective 01 April 2026 · Rates per annum, subject to change

Deposits below ₹2,00,00,000 — general public.
7-14 days 3.00% · 15-45 days 3.50% · 46-90 days 4.50% · 91-179 days 5.25% · 180-269 days 6.00% ·
270-364 days 6.50% · 1 year to 15 months 7.00% · 15 months to 2 years 7.10% · 2 to 3 years 7.00% ·
3 to 5 years 6.75% · above 5 years 6.50%.

Senior citizens (60 and above) receive an additional 0.50% on tenors of 180 days and above. Super senior
citizens (80 and above) receive an additional 0.75%. The benefit is not available on non-resident
deposits.

Tax-saving deposit. Five-year lock-in, 6.75%, deduction available under Section 80C, no premature
withdrawal, no loan against the deposit.

Recurring deposit. 12 months 6.75% · 24 months 7.00% · 36 months 7.00% · 60 months 6.75%. A missed
instalment attracts ₹1 per ₹100 per month on the instalment amount.

Premature withdrawal. Permitted after 7 days. Interest is paid at the rate applicable for the period the
deposit actually ran, less a penalty of 1.00%; no interest is payable for a deposit closed within 7 days.
No penalty on death of the depositor, or where the proceeds are reinvested for a longer tenor.

Loan against deposit. Up to 90% of the principal, at the deposit rate plus 2.00%.

Tax. Interest is subject to TDS where it exceeds ₹40,000 in a financial year (₹50,000 for senior
citizens). Form 15G or 15H may be submitted at the start of the year. PAN is mandatory; without PAN, TDS
is deducted at 20%.`,

  'Savings Account Tariff 2026.pdf': `SAVINGS ACCOUNT TARIFF
Retail Liabilities · Effective 01 April 2026 · All charges exclusive of GST

Interest. 3.00% a year on balances up to ₹5,00,000; 3.50% above that, calculated on daily balance and
credited quarterly.

Minimum balance. Metro and urban ₹5,000 · semi-urban ₹2,500 · rural ₹1,000. Basic Savings Bank Deposit
Account: nil minimum balance, no charge for non-maintenance, four free cash withdrawals a month.
Non-maintenance charge: 5% of the shortfall, capped at ₹250 a month for metro and urban, ₹150 for
semi-urban, ₹100 for rural. No charge is levied on an account of a minor, a pensioner, or a beneficiary
of a government scheme.

Cash handling at the branch. Four free cash transactions a month; thereafter ₹50 a transaction. Free cash
deposit up to ₹2,00,000 a month; above that ₹2 per ₹1,000, minimum ₹50.

Cheques. First 25 leaves free each financial year, thereafter ₹3 a leaf. Cheque return for insufficient
funds ₹500 for the drawer; inward return ₹100. Stop payment ₹100 a cheque, ₹300 for a range.

Digital payments. NEFT, RTGS, IMPS and UPI initiated on digital channels: nil. At a branch, NEFT up to
₹10,000 ₹2.50, ₹10,001-₹1,00,000 ₹5, above ₹1,00,000 ₹15. RTGS at a branch ₹20 up to ₹5,00,000 and ₹40
above.

Statements and certificates. e-statement nil. Duplicate physical statement ₹100. Balance certificate
₹100. Interest certificate nil once a year. Account closure within 12 months of opening ₹500; after 12
months nil.

Standing instruction failure ₹100. SMS alerts ₹15 a quarter. Nomination registration or change nil.
The full tariff is displayed at every branch and on the website, and no charge outside it may be levied.`,

  // ── Suraksha Life & Health · Insurance Policies & SOPs ───────────────────────────────────────────
  'Cashless Network & Pre-Authorisation SOP': `CASHLESS NETWORK AND PRE-AUTHORISATION SOP
Suraksha · Health Claims · Version 3.1

What pre-authorisation decides. Whether the proposed treatment is admissible and up to what amount the
insurer will settle directly with the network hospital. It is not a guarantee of the final bill.

Turnaround. Planned admission: decision within 60 minutes of a complete request on the provider portal.
Emergency: initial decision within 60 minutes, with an interim approval up to ₹50,000 where clinical
information is incomplete so treatment is not delayed. Enhancement during stay: 60 minutes, or by 08:30
next morning for requests after 20:00. Discharge: final decision within 3 hours of the final bill.
Every clock starts when the request is complete; an incomplete request is queried within 30 minutes with
one consolidated list.

A complete request. Member id and policy number; treating doctor's name and registration number;
provisional diagnosis with ICD code; proposed line of treatment; estimated cost split into room,
professional fees, investigations, consumables and implants; expected length of stay; date of first
symptom.

Outcomes. Approved with amount and 15-day validity · approved with deductions, each referenced to a
clause · query raised once, consolidated · denied with the clause cited and the grievance route stated.

Escalation. Pending beyond 90 minutes escalates automatically to the Claims Manager. Denials above
₹2,00,000 are reviewed the same day by a second medical officer.

Network discipline. The agreed tariff governs; billing above tariff is settled at tariff and the
difference is not passed to the member. Any demand for a cash deposit on an approved cashless claim is a
network breach recorded against the hospital's empanelment.`,

  'Health Indemnity Policy Wording (IRDAI)': `HEALTH INDEMNITY POLICY — KEY WORDING
Suraksha · Product & Compliance · IRDAI-aligned · Version 5.0

Cover. Reasonable and customary expenses of medically necessary hospitalisation of at least 24
consecutive hours, or a listed day-care procedure, within the sum insured for the policy year.
Included: room and nursing, ICU, professional fees, anaesthesia, blood, oxygen, operation theatre,
drugs and consumables, diagnostics, implants and prosthetics used during the procedure, pre-
hospitalisation for 30 days and post-hospitalisation for 60 days.

Waiting periods. 30 days from inception for any illness other than accident. 24 months for listed
ailments including cataract, hernia, benign prostate conditions and joint replacement. 36 months for
declared pre-existing disease, counted from first inception where cover is continuous.

Standard exclusions. Investigation and evaluation admissions with no active treatment; rest cure and
rehabilitation; obesity and weight-control treatment except where clinically indicated and above the
stated BMI; cosmetic surgery except reconstruction after accident or cancer; change of gender; hazardous
adventure sports; breach of law; treatment for alcoholism and substance abuse; unproven treatments;
maternity except under a maternity extension.

Sharing of cost. Co-payment and deductible apply as stated in the schedule, and are applied after all
limits and exclusions.

Renewal and portability. Lifelong renewability. Renewal is not denied except for fraud, moral hazard or
misrepresentation. A 30-day grace period applies; cover does not exist during a break. Portability to
another insurer is permitted at renewal on 45 days' notice, carrying accrued waiting-period credit.

Free look. 30 days from receipt of the policy. Claim intimation: 24 hours for emergency admission, 48
hours before a planned admission. Reimbursement documents within 15 days of discharge.
Cumulative bonus: 10% of sum insured for each claim-free year, up to 50%, reduced by 10% after a claim.`,

  'Health Top-Up & Super Top-Up Eligibility Rules': `TOP-UP AND SUPER TOP-UP ELIGIBILITY RULES
Suraksha · Product & Underwriting · Version 2.6

Definitions. A top-up pays hospitalisation expenses above a chosen threshold (the deductible) on a
per-claim basis. A super top-up applies the threshold on an aggregate basis across the policy year, so
several smaller claims can together cross it.

Thresholds and sums insured. Deductible options ₹3,00,000, ₹5,00,000 and ₹10,00,000. Sum insured options
₹10,00,000 to ₹1,00,00,000, in steps of ₹5,00,000. The sum insured may not exceed ten times the chosen
deductible.

Eligibility. Age 18 to 65 at entry for the proposer, dependent children from 91 days to 25 years.
A base indemnity policy is not mandatory — the deductible may be met from the member's own funds, an
employer policy, or another insurer's policy — but the source is declared at proposal.

Underwriting. Below ₹25,00,000 sum insured and age under 45: declaration of health only.
Age 46-55 or sum insured ₹25,00,001-₹50,00,000: medical questionnaire, blood profile and urine analysis.
Age above 55 or sum insured above ₹50,00,000: full medicals per the health grid, and senior underwriter
review. Declared diabetes or hypertension: loading of 15% to 40% by control status; uncontrolled disease
with end-organ damage is postponed.

How the deductible is applied. The admissible claim amount is computed first under the policy's own
limits and exclusions. The deductible is then subtracted. Only the excess is payable. Non-admissible
expenses never count towards satisfying the deductible.

Waiting periods. 30 days initial; 24 months for listed ailments; 36 months for pre-existing disease.
Continuous coverage under a previous top-up with the same insurer carries credit for served periods.

Claims interface. A single claim file covers base and top-up where both are with Suraksha; the member
files once. Where the base cover is with another insurer, a settlement letter from that insurer is
required before the top-up is assessed.`,

  'Hospitalisation & Room-Rent Sub-Limit Guide': `HOSPITALISATION AND ROOM-RENT SUB-LIMIT GUIDE
Suraksha · Health Claims · Version 2.9

Room entitlement by plan. Plan A (sum insured ₹3,00,000-₹5,00,000): shared room, room rent capped at 1%
of sum insured a day, ICU at 2% a day. Plan B (₹5,00,001-₹10,00,000): single private room, no monetary
cap, ICU at actuals. Plan C (above ₹10,00,000): single private room or above, ICU at actuals, no
proportionate deduction. Suite and deluxe categories are outside entitlement in every plan.

Proportionate deduction, worked. Sum insured ₹5,00,000 means an entitlement of ₹5,000 a day. Room taken
at ₹8,000 a day gives a ratio of 62.5%. Charges that vary with room category — nursing ₹12,000, surgeon
₹60,000, operation theatre ₹25,000 — are payable at 62.5%. Pharmacy, investigations and implants are
paid in full, subject to their own caps. Room rent itself is paid at the entitled ₹5,000 a day.

Disease-wise sub-limits (Plans A and B, per claim). Cataract ₹40,000 per eye · knee replacement
₹2,00,000 per knee · hernia ₹60,000 · hysterectomy ₹75,000 · angioplasty including stent ₹2,50,000 ·
dialysis ₹5,000 a session. A sub-limit is the ceiling for the whole episode.

Other limits applied before the sum insured. Ambulance ₹3,000 per hospitalisation · pre-hospitalisation
30 days · post-hospitalisation 60 days · domiciliary hospitalisation up to 10% of sum insured · modern
treatment methods up to 50% of sum insured.

Order of application. Proportionate deduction → disease sub-limit → non-payable items → co-payment →
deductible → sum insured with cumulative bonus. Applying co-payment before the sub-limit understates the
payable and is the most common assessment error found in audit.

No double deduction. A charge already reduced by proportionate deduction is not reduced again under a
sub-limit; the lower single outcome applies, and the settlement sheet shows the order used.`,

  'Motor FNOL Intake & Survey Allocation SOP': `MOTOR FNOL INTAKE AND SURVEY ALLOCATION SOP
Suraksha · Motor Claims · Version 4.1

Intake. The first question is whether anyone is injured; an injury makes the claim medico-legal, with a
call-back by a claims officer within 30 minutes. A claim is not registered without: policy number and
vehicle registration; date, time and place of loss with a landmark; caller's name, mobile and
relationship to the insured; the driver at the time with licence number and validity; the incident in the
caller's words; third-party involvement; police intimation and FIR number; the vehicle's location and
whether it is drivable; the preferred garage.

Never promised on the call. Admissibility, amount payable, depreciation treatment, repair timeline, or
cashless status before the garage is confirmed in network for that city.

Allocation. Automatic by pin code, loss band and surveyor availability. Licence validity and monetary
limit are checked automatically; an expired licence blocks allocation. Related-party allocation is
refused, and the conflict declaration forms part of acceptance.

Turnaround by band. Up to ₹25,000 and drivable with no third party: photograph-based assessment, no
surveyor. ₹25,001-₹1,00,000: surveyor within 4 hours, spot survey within 24 hours. Above ₹1,00,000,
suspected total loss, theft, or third-party injury: senior surveyor within 2 hours, Claims Manager
notified, investigation file opened.

Survey report. Due within 72 hours of survey, with photographs of all four corners, each damaged panel,
odometer, chassis plate, registration plate and driving licence, plus verification of the damage pattern
against the reported cause of loss and the driver's signed statement.

Escalation. Any breach of allocation or report turnaround escalates to the Claims Manager with a reason
code, and is reported weekly with the count of manual overrides.`,

  'Motor Own-Damage Claim Assessment SOP': `MOTOR OWN-DAMAGE CLAIM ASSESSMENT SOP
Suraksha · Motor Claims · Version 3.8

Assessment sequence. Confirm cover on the date of loss and the premium realised. Confirm the driver held
a valid licence for the class of vehicle. Match the damage pattern to the reported cause of loss.
Itemise into parts to replace, parts to repair, labour hours, painting by panel, and consumables.

Depreciation on parts by vehicle age. Up to 6 months nil · 6 months-1 year 5% · 1-2 years 10% · 2-3
years 15% · 3-4 years 25% · 4-5 years 35% · 5-10 years 40% · above 10 years 50%. Rubber, nylon, plastic,
tyres, tubes and batteries 50% flat. Fibreglass 30%. Glass nil.

Labour and paint. Labour at the network tariff for the city. Painting assessed by panel count at the
agreed per-panel rate, never on invoice value. Betterment is deducted where the replacement improves the
pre-accident condition.

Total loss. Where assessed repair cost plus salvage recovery exceeds 75% of the Insured Declared Value,
the claim is settled as a constructive total loss on the IDV less retained salvage. Salvage is disposed
through the approved buyer panel on a minimum of three sealed quotations.

Deductions and disclosure. Every deduction cites the policy clause or the depreciation row it comes from.
The settlement letter shows the assessed amount, each deduction with its reference, the compulsory
deductible, and the net payable.

Re-inspection and audit. Mandatory re-inspection above ₹1,00,000 and for every replaced airbag, plus a
5% random sample; a mismatch stops payment and opens an enquiry. Ten percent of assessments are audited
monthly, with variance beyond 10% triggering a surveyor review.

Turnaround. Assessment within 72 hours of survey; settlement within 7 working days of receiving the final
invoice and the satisfaction note.`,

  'Policy Lapse, Revival & Grace Period Rules': `POLICY LAPSE, REVIVAL AND GRACE PERIOD RULES
Suraksha · Life Operations · Version 5.0

Grace period. 15 days for monthly premium mode, 30 days for quarterly, half-yearly and annual modes.
Cover continues through the grace period; a claim arising in that window is paid after deducting the due
premium.

Lapse. Non-payment beyond the grace period lapses the policy. With fewer than two years' premiums paid
there is no surrender value and cover ceases. With two years or more the policy becomes reduced paid-up
where the product provides, and the paid-up sum assured is stated in the lapse intimation.

Revival window. Five years from the date of the first unpaid premium.

Revival on ordinary terms. Within six months of the first unpaid premium: arrears plus interest at the
declared revival rate, no fresh declaration of health.
Revival after six months: arrears with interest, a declaration of good health, and underwriting review.
Medical tests are called for where the sum at risk exceeds the non-medical limit for the attained age.
Revival is an underwriting decision, not a right; a decline is communicated in writing with the medical
or financial reason and the route to a second opinion.

Effect of revival on clauses. Where the product terms so provide, exclusion clauses — including the
suicide clause — run again from the date of revival. This is stated in the revival letter before payment
is accepted.

Automatic protections. Where a policy has acquired surrender value and a premium is unpaid, the automatic
non-forfeiture provision applies as per the product terms before lapse is recorded.

Communication. Premium-due notices are sent 30, 15 and 3 days before the due date, and a lapse
intimation within 7 days of the grace period ending, stating the revival window, the amount due and the
paid-up value if any. Every revival quotation is valid for 30 days.`,
};

// ── Corrections to documents that DO have text ───────────────────────────────────────────────────────
// One-line repairs, kept separate from the corpus so they are visibly deliberate. The AML thresholds
// document rendered "above $10,00,000" — a dollar sign against Indian digit grouping, in a bank's own
// AML policy. Wrong currency in a compliance threshold is not a typo a BFSI reviewer forgives.
export const ORG_DOC_FIXES: { name: string; find: string; replace: string }[] = [
  { name: 'AML Transaction Monitoring Thresholds', find: '$10,00,000', replace: '₹10,00,000' },
  { name: 'AML Transaction Monitoring Thresholds', find: '$50,000', replace: '₹50,000' },
  { name: 'AML Transaction Monitoring Thresholds', find: '$5,00,000', replace: '₹5,00,000' },
];
