// ─── Real text for the demo PROJECT knowledge documents ────────────────────────────────────────────
//
// LIVE FINDING (2026-07-31). Opening a project knowledge document showed:
//
//   "Extract from RBI Fair Practices Code — Recovery Conduct.md.
//    This document is indexed for this project. Chats in the project retrieve from it and cite it by
//    name, and its contents never leave this deployment."
//
// A placeholder about the document instead of the document. Every one of the 20 seeded project
// documents said that, which makes the whole grounding claim unverifiable by a reviewer: you cannot
// check a citation against a sentence describing the file.
//
// So this is the real text — Indian BFSI, clause-shaped, INR, RBI/IRDAI references, the way a bank's or
// an insurer's internal SOP actually reads. Keyed by the document name the seed created.
// Applied by scripts/reindex-knowledge.mts, which re-chunks and re-embeds through the SAME
// chunk→embed path the product uses, so retrieval and citation are exercised for real.

export const PROJECT_DOCS: Record<string, string> = {
  'RBI Fair Practices Code — Recovery Conduct.md': `FAIR PRACTICES CODE — RECOVERY AND COLLECTIONS CONDUCT
Bharat Union Co-operative Bank · Collections & Recovery · Version 4.1 · Effective 01 April 2026
Issued under the RBI Master Direction on Fair Practices Code and the RBI circular on Recovery Agents.

1. SCOPE
1.1 This code binds every employee, recovery agent and agency acting for the Bank on any retail loan,
including personal loans, two-wheeler loans, gold loans and loans against property.
1.2 A recovery agency may only be deployed after empanelment, agent-level KYC and a signed conduct
undertaking. The empanelled agent list is reviewed quarterly by the Head of Collections.

2. CONTACT HOURS AND FREQUENCY
2.1 Borrower contact is permitted only between 08:00 and 19:00 IST, on any day other than a declared
national holiday.
2.2 A maximum of three (3) contact attempts per borrower per day and nine (9) per week are permitted
across all channels combined (voice, SMS, WhatsApp, email, field visit).
2.3 Once a borrower states a preferred contact window in writing, that window overrides 2.1 and must be
recorded on the account within one working day.

3. PROHIBITED CONDUCT
3.1 No contact with the borrower's employer, neighbours or relatives regarding the debt, except a
co-borrower or guarantor on the same facility.
3.2 No threat of arrest, criminal prosecution, publication of the borrower's name, or disclosure of the
debt to any third party.
3.3 No use of abusive, obscene or intimidating language; no persistent calling designed to harass; no
contact at the borrower's workplace without prior written consent.
3.4 No collection of cash without issuing a numbered receipt from the Bank's receipt series on the spot.

4. HARDSHIP AND FORBEARANCE
4.1 A borrower reporting job loss, hospitalisation or a death in the family is placed on a 30-day
contact hold, extendable once, on approval by a Collections Manager.
4.2 A restructuring proposal must be recorded with the borrower's declared monthly surplus. Instalments
under a restructure may not exceed 50% of declared monthly surplus.
4.3 Settlement discount authority: up to ₹25,000 waiver by a Collections Manager; ₹25,001–₹2,00,000 by
the Regional Head; above ₹2,00,000 by the Credit Committee.

5. GRIEVANCE AND ESCALATION
5.1 Every collections communication must carry the Nodal Officer's name, telephone number and email.
5.2 A borrower grievance is acknowledged within 48 hours and resolved within 21 days. Unresolved
grievances are escalated to the RBI Integrated Ombudsman Scheme, and the borrower is told so in writing.
5.3 Any allegation of misconduct by an agent triggers immediate suspension of that agent from the
account pending enquiry, and the account is moved to in-house recovery.

6. RECORD KEEPING
6.1 Call recordings are retained for 24 months; field visit reports for 60 months.
6.2 Every contact attempt is logged with timestamp, channel, agent id and outcome code. An unlogged
contact is treated as a breach of this code.`,

  '90-DPD Treatment Matrix & Escalation Ladder.md': `90-DPD TREATMENT MATRIX AND ESCALATION LADDER
Collections & Recovery · Retail Assets · Version 2.6 · Effective 01 April 2026

1. BUCKET DEFINITIONS
Bucket 0 (0 DPD): current. Bucket 1: 1–30 DPD. Bucket 2: 31–60 DPD. Bucket 3: 61–90 DPD.
NPA: 91+ DPD (sub-standard on classification). Bucket X: 180+ DPD, doubtful.
DPD is computed from the earliest unpaid instalment due date, not from the last payment date.

2. TREATMENT BY BUCKET
Bucket 1 — automated reminder SMS on D+3, D+10 and D+20; one tele-calling attempt after D+15.
No field visit. No penal charge until D+15.
Bucket 2 — tele-calling twice weekly; one field visit permitted after D+45; the account is flagged for
the branch relationship manager; a payment plan may be offered without approval.
Bucket 3 — allocation to an empanelled agency permitted; field visits up to twice a week; a settlement
proposal may be recorded but not accepted below the approval matrix in the Fair Practices Code.
NPA (91+) — mandatory account review by the Regional Credit Head within 15 days; SARFAESI notice
evaluation for secured facilities above ₹20,00,000; legal notice for unsecured facilities above
₹5,00,000; write-off recommendation only after 12 months in NPA.

3. ESCALATION LADDER (90+ DPD)
Step 1 (day 91–100): Collections Officer records a contactability status — contactable, skip-trace
required, or disputed. A disputed account leaves the collections queue and enters the grievance queue.
Step 2 (day 101–120): Regional Head reviews exposure, security position and the borrower's declared
hardship. Outcome must be one of: restructure, settlement, legal, or hold.
Step 3 (day 121–150): legal notice under Section 138 (if cheque dishonour) or a demand notice; for
secured accounts, valuation refresh and SARFAESI 13(2) notice preparation.
Step 4 (day 151–180): Credit Committee decision. Accounts above ₹50,00,000 go to the Board Recovery
Committee irrespective of security.

4. EXPOSURE THRESHOLDS FOR TREATMENT INTENSITY
Up to ₹1,00,000 — tele-calling only, no field cost; settlement authority with the Collections Manager.
₹1,00,001 to ₹10,00,000 — agency allocation permitted; field visit cost capped at ₹1,500 per account.
Above ₹10,00,000 — in-house recovery only; no agency allocation; monthly review at Regional Credit.

5. PROHIBITED IN EVERY BUCKET
Contact outside 08:00–19:00 IST; more than three attempts a day; contact with third parties; any
promise of waiver not backed by written approval per the authority matrix.

6. REPORTING
Bucket movement, resolution rate and cost-to-collect are reported to the Credit Committee monthly.
Any month where 90+ DPD balances rise more than 15% triggers a portfolio review.`,

  'Approved Dunning Language & Prohibited Phrases.md': `APPROVED DUNNING LANGUAGE AND PROHIBITED PHRASES
Collections Communications · Version 3.3 · Effective 01 April 2026
Every outbound collections message must use an approved template. Free-text drafting is not permitted.

1. APPROVED OPENERS
"Dear {{customer_name}}, our records show an outstanding balance of ₹{{amount_inr}} on your account
ending {{account_last4}}, now {{dpd}} days past due."
"We would like to help you bring your account up to date. Please contact us on {{contact_number}} to
discuss repayment options available to you."
"If you have already made this payment, please share the transaction reference (UTR) and we will update
your account within two working days."

2. APPROVED CLOSERS
"This communication is from the Collections team of Bharat Union Co-operative Bank. Our Nodal Officer
can be reached at {{nodal_email}} or {{nodal_phone}}."
"If you are facing financial difficulty, you may be eligible for a restructured repayment plan. Ask us
about it — there is no charge for the discussion."

3. PROHIBITED PHRASES — never use, in any channel
"legal action will be taken today" (no legal step may be asserted before it is approved and issued)
"you will be arrested" / "criminal case" (a civil debt is not a criminal matter)
"we will inform your employer / your family / your neighbours"
"final notice" (unless a formal notice has actually been issued under the approval matrix)
"your CIBIL will be destroyed" (credit bureau reporting is factual and must be described factually)
"immediate" / "within the hour" deadlines designed to create panic
Any reference to the borrower's caste, religion, gender or medical condition.

4. FACTUAL STATEMENTS PERMITTED ABOUT CREDIT BUREAUS
"Repayment behaviour on this account is reported to credit information companies as required under the
Credit Information Companies (Regulation) Act, 2005."
Nothing further about scores, effects or timelines may be asserted.

5. LANGUAGE AND ACCESSIBILITY
Templates are maintained in English, Hindi and Marathi. The borrower's registered language preference
governs. A borrower who states they do not understand a message is re-sent the approved translation.

6. REVIEW AND CONTROL
6.1 Every template change is approved by Compliance before release, and versioned.
6.2 Outbound messages are sampled weekly (minimum 5% of volume) and scored against this document.
Any message containing a prohibited phrase is a reportable conduct breach.`,

  'Employee Reimbursement Policy FY26.md': `EMPLOYEE REIMBURSEMENT POLICY — FY 2025-26
People & Finance · Version 6.0 · Effective 01 April 2025

1. ELIGIBILITY
1.1 All employees on the Bank's rolls, confirmed or on probation, may claim reimbursement of expenses
incurred wholly for Bank business.
1.2 Contractors and empanelled vendors are paid on invoice and are outside this policy.

2. CLAIM WINDOW
2.1 A claim must be submitted within 30 days of the expense date. Claims between 31 and 60 days require
a written justification and the approval of the function head.
2.2 Claims older than 60 days are rejected, with no exception below the level of CFO.

3. DOCUMENTATION
3.1 Every claim line requires a GST-compliant invoice showing the vendor's GSTIN, the amount and the
date. A payment receipt alone is not sufficient.
3.2 Claims of ₹5,000 and above additionally require the digital payment reference (UPI/NEFT/card) —
cash payment above ₹5,000 is not reimbursable.
3.3 Local conveyance up to ₹500 per day may be claimed on a self-declaration without an invoice.

4. CATEGORY LIMITS (per claim, unless stated)
Local conveyance: ₹1,500 per day. Intercity travel: as per the Travel Grade Matrix.
Hotel (metro): ₹6,000 per night. Hotel (non-metro): ₹4,000 per night.
Meals on tour: ₹1,200 per day (metro), ₹800 per day (non-metro).
Client entertainment: ₹2,500 per occasion, business purpose and attendee list mandatory.
Mobile and data: ₹1,000 per month, grade M3 and above.
Professional membership: ₹15,000 per financial year, one body, pre-approval required.

5. APPROVAL FLOW
5.1 Up to ₹10,000 — reporting manager.
5.2 ₹10,001 to ₹50,000 — reporting manager and function head.
5.3 Above ₹50,000 — function head and Finance Controller.
5.4 Any claim by an employee on their own reporting line is approved one level up.

6. PROHIBITED CLAIMS
Alcohol; personal shopping; traffic fines; loss of personal property; family travel; any payment to a
government official; any expense already covered by a Bank-issued corporate card settlement.

7. PAYMENT AND RECOVERY
7.1 Approved claims are paid with the next payroll cycle, or within 10 working days for claims above
₹1,00,000.
7.2 A claim later found to be duplicated or unsupported is recovered from salary after notice, and a
second instance is referred to Disciplinary Committee.`,

  'Category Quota & Approval Thresholds.md': `CATEGORY QUOTA AND APPROVAL THRESHOLDS — FY 2025-26
People & Finance · Companion to the Employee Reimbursement Policy · Version 2.4

1. HOW QUOTA WORKS
1.1 A quota is an annual entitlement per employee per category, consumed by approved claims and reset
on 1 April. Unused quota does not carry forward.
1.2 Quota is checked at submission. A claim that would exceed the remaining quota is not blocked — it is
routed to the next approval tier and paid only on that approval.

2. ANNUAL QUOTA BY GRADE (₹ per financial year)
Grade M1-M2: conveyance 60,000 · meals 24,000 · learning 20,000 · mobile nil.
Grade M3-M4: conveyance 96,000 · meals 36,000 · learning 40,000 · mobile 12,000.
Grade M5-M6: conveyance 1,44,000 · meals 60,000 · learning 75,000 · mobile 12,000.
Grade M7 and above: conveyance at actuals with function head approval · meals 90,000 · learning
1,50,000 · mobile 18,000.

3. APPROVAL THRESHOLDS
3.1 Within quota and below ₹10,000: single approval (reporting manager).
3.2 Within quota and ₹10,001-₹50,000: reporting manager plus function head.
3.3 Exceeding remaining quota by up to 20%: function head, with the overage stated in the approval note.
3.4 Exceeding remaining quota by more than 20%: Finance Controller. A quota overage above 50% requires
a written business case and is reported in the monthly exceptions pack.

4. SPECIAL CASES
4.1 Relocation: outside quota, governed by the relocation policy, approved by the People function.
4.2 Client-facing roles may apply for a mid-year quota uplift once, capped at 25% of the annual figure,
approved by the function head and Finance.
4.3 Statutory or regulatory training required for a role is outside the learning quota.

5. CONTROLS
5.1 Quota consumption is reconciled monthly against the general ledger expense heads.
5.2 An employee whose claims exceed 90% of any quota by Q3 is flagged to their function head, so the
remaining entitlement is planned rather than exhausted.
5.3 Splitting a single expense across claims or months to stay under a threshold is a policy breach.`,

  'RBI KYC Master Direction — Periodic Review.md': `PERIODIC KYC REVIEW (RE-KYC) — OPERATING STANDARD
Compliance · Aligned to the RBI Master Direction on Know Your Customer · Version 5.2

1. PERIODICITY BY RISK CATEGORY
High risk: every 2 years. Medium risk: every 8 years. Low risk: every 10 years.
The clock runs from the date of the last full KYC verification recorded on the customer master, not from
account opening.

2. WHAT RE-KYC REQUIRES
2.1 Re-confirmation of identity and address using a currently valid Officially Valid Document (OVD).
2.2 Fresh photograph for individual accounts where the record on file is older than 10 years.
2.3 Confirmation of the customer's current occupation, income band and the purpose of the relationship.
2.4 Screening against the sanctions and PEP lists on the date of review.
2.5 For a legal entity: refreshed beneficial ownership declaration where any holding exceeds 10%.

3. NO-CHANGE DECLARATION
3.1 Where there is no change in KYC information, a self-declaration through a registered channel
(branch, ATM, net banking, mobile banking, letter, or registered email/mobile) is sufficient.
3.2 Where only the address has changed, a self-declaration of the new address is accepted, followed by
verification of the declared address within two months.

4. CONSEQUENCE OF NON-COMPLETION
4.1 A customer whose re-KYC is overdue is notified three times: 90, 60 and 30 days before the due date,
through registered mobile and email.
4.2 Where re-KYC remains incomplete after the due date, partial freeze is applied — credits permitted,
debits restricted — after a further written notice of not less than 30 days.
4.3 Full freeze and reporting follow only after six months of partial freeze, and require the Principal
Officer's approval. Pension accounts and accounts of persons above 70 are escalated for manual review
before any restriction.

5. DIGITAL AND ASSISTED CHANNELS
5.1 Video-based Customer Identification Process (V-CIP) is permitted for re-KYC, subject to the
technical and geo-tagging standards in the V-CIP SOP, with the recording retained for 10 years.
5.2 A customer above 60, or one who declines a digital channel, must be offered branch-assisted re-KYC
and may not be refused service for that reason.

6. RECORD AND AUDIT
6.1 Every re-KYC event records who verified it, which documents were seen, the screening result and the
risk category assigned after review.
6.2 A monthly exception report lists overdue re-KYC by branch and risk category and is placed before the
Audit Committee quarterly.`,

  'Officially Valid Document (OVD) Checklist.md': `OFFICIALLY VALID DOCUMENT (OVD) CHECKLIST
Branch Operations & Compliance · Version 4.0 · Effective 01 April 2026

1. ACCEPTED OVDs FOR IDENTITY AND ADDRESS
Passport (valid, not expired) · Driving licence (valid) · Voter's identity card issued by the Election
Commission · Job card issued by NREGA signed by a State Government officer · Letter issued by the
National Population Register containing name and address · Proof of possession of Aadhaar number,
subject to clause 3.

2. PAN
2.1 PAN is mandatory for account opening and for any transaction where the Income Tax rules require it.
PAN format is five letters, four digits, one letter — e.g. ABCDE1234F. The fourth character denotes the
holder type: "P" individual, "C" company, "H" HUF, "F" firm.
2.2 Where PAN is not available, Form 60 is obtained and retained. Form 60 does not substitute an OVD.

3. AADHAAR HANDLING — MANDATORY MASKING
3.1 Only the last four digits of the Aadhaar number may be retained or displayed. Any copy taken must
have the first eight digits redacted before it is stored (e.g. XXXX XXXX 4321).
3.2 The Bank does not store the full Aadhaar number in any system of record, screenshot, email or chat.
3.3 Offline verification (XML/QR/e-KYC) is preferred over a physical copy.

4. WHERE THE OVD DOES NOT CARRY THE CURRENT ADDRESS
4.1 A deemed-OVD may be accepted for address: utility bill not older than two months (electricity,
telephone, post-paid mobile, piped gas, water), property or municipal tax receipt, pension payment
order, or an employer-allotted accommodation letter from a listed entity.
4.2 The customer must then submit an updated OVD with the current address within three months.

5. LEGAL ENTITIES
Certificate of incorporation · Memorandum and Articles · Board resolution and list of authorised
signatories · PAN of the entity · OVD and PAN of each authorised signatory and of every beneficial
owner holding more than 10% · GST registration certificate where registered.

6. VERIFICATION DISCIPLINE
6.1 Originals are seen and the copy is stamped "verified with original", signed, dated and initialled
with the employee id.
6.2 A document in a language other than English or Hindi requires a certified translation on record.
6.3 Any document that is illegible, altered, or whose photograph does not match the customer is refused
and the attempt is logged.`,

  'Retail Lending Credit Policy.md': `RETAIL LENDING CREDIT POLICY
Credit · Retail Assets · Version 7.1 · Effective 01 April 2026

1. PRODUCT SET AND EXPOSURE CAPS
Personal loan: ₹50,000 to ₹20,00,000, tenor 12-60 months, unsecured.
Two-wheeler loan: up to 85% of on-road price, tenor up to 48 months.
Loan against property: up to 65% of the assessed market value, tenor up to 180 months.
Gold loan: up to 75% loan-to-value on the RBI-notified gold rate, tenor up to 12 months, bullet or EMI.
Aggregate unsecured retail exposure may not exceed 22% of total advances.

2. ELIGIBILITY
2.1 Age at application 21 years or above; age at maturity not above 60 (salaried) or 65 (self-employed).
2.2 Minimum net monthly income: ₹25,000 metro, ₹18,000 non-metro (salaried); minimum annual business
income ₹4,00,000 as per the latest ITR (self-employed).
2.3 Minimum employment: 12 months total work experience and 6 months in the current organisation.
2.4 Residence or business address within the branch's service geography.

3. CREDIT BUREAU NORMS
3.1 CIBIL score 730 and above: standard approval track.
3.2 700-729: approval permitted with one compensating factor (salary account with the Bank, existing
loan closed with no delinquency, or LTV 10 points below the cap).
3.3 Below 700: declined on the standard track; a deviation requires Regional Credit Head approval and
is capped at 5% of monthly disbursal count.
3.4 Any write-off, settlement or suit-filed record in the last 36 months is a decline, without deviation.
3.5 More than three unsecured facilities live across lenders is a decline for a new unsecured facility.

4. DEBT SERVICE (FOIR)
4.1 FOIR, inclusive of the proposed EMI, may not exceed 50% for net monthly income up to ₹75,000, and
55% above it. Obligations below ₹1,000 a month are ignored.
4.2 Income considered is the average of the last three months' credited salary, or the latest two years'
ITR averaged for self-employed applicants.

5. DEVIATION AND APPROVAL AUTHORITY
Up to ₹5,00,000 — Branch Credit Manager. ₹5,00,001-₹20,00,000 — Regional Credit Head.
Above ₹20,00,000 or any policy deviation — Credit Committee. Every deviation is logged with the
compensating factor and reviewed monthly for portfolio drift.

6. POST-SANCTION
6.1 Disbursal only after the sanction conditions, the mandate for repayment and the insurance (where
applicable) are on record.
6.2 Early portfolio review at 6 months on any cohort where 30+ DPD exceeds 3%.`,

  'Income Documentation & FOIR Norms.md': `INCOME DOCUMENTATION AND FOIR NORMS
Credit · Underwriting Standards · Version 3.5

1. SALARIED APPLICANTS — DOCUMENTS
Latest three months' salary slips; bank statement of the salary account for six months showing the
salary credit; Form 16 or the latest ITR acknowledgement; employer identity card.
Where salary is paid in cash, the case is treated as self-employed for income assessment.

2. SELF-EMPLOYED APPLICANTS — DOCUMENTS
ITR with computation for the last two assessment years; audited financials where turnover exceeds
₹1,00,00,000; GST returns for the last four quarters; current account statement for 12 months;
proof of business continuity for three years (registration, licence, or GST registration date).

3. INCOME RECOGNISED
3.1 Salaried: net monthly credited salary, averaged over three months. Variable pay is counted at 50%
and only when it has been paid in each of the last four quarters.
3.2 Self-employed: profit after tax plus depreciation, averaged over two years. A year-on-year fall in
income greater than 25% caps the recognised income at the lower year.
3.3 Rental income: 70% of the registered lease amount, where the lease has more than 12 months to run.
3.4 Agricultural income is recognised only against a land record and is capped at 40% of total income.
3.5 Cash deposits with no traceable source are never recognised as income.

4. OBLIGATIONS COUNTED IN FOIR
Every live EMI from the bureau report; 5% of the sanctioned limit on any revolving card or overdraft;
credit card minimum due where the card has been revolving for three consecutive months; the proposed
EMI at the offered rate. Obligations closed within 30 days may be excluded on proof of closure.

5. FOIR CEILINGS
Net monthly income up to ₹40,000 — 40%. ₹40,001 to ₹75,000 — 50%. ₹75,001 to ₹2,00,000 — 55%.
Above ₹2,00,000 — 60%. Secured facilities may go 5 points higher with Regional Credit Head approval.

6. VERIFICATION AND FRAUD CHECKS
6.1 Salary credit in the statement is matched to the employer name on the slip; a mismatch requires
employer confirmation before sanction.
6.2 Employer is verified against the approved employer list; unlisted employers require a telephonic
verification recorded on file.
6.3 Documents are checked for tampering — inconsistent fonts, altered figures, identical PDF metadata
across applicants — and any suspicion is referred to the Fraud Risk unit before a decision.`,

  'Branch Operations Circular — Counter Services.md': `BRANCH OPERATIONS CIRCULAR — COUNTER SERVICES
Branch Banking · Circular 2026/14 · Effective 01 April 2026

1. SERVICE HOURS AND QUEUE MANAGEMENT
1.1 Counters open 10:00 and close 16:00 for public transactions; the branch remains open for enquiries
until 17:00. Saturdays: 10:00 to 13:00, first and third Saturday only.
1.2 A token system is mandatory where average footfall exceeds 120 customers a day. Senior citizens,
persons with disability and pregnant women are served on priority without a token.
1.3 A customer present in the branch before closing time is served.

2. CASH TRANSACTIONS
2.1 Cash deposit by a non-customer into a third-party account is restricted to ₹50,000 per transaction
and requires the depositor's PAN or Form 60.
2.2 Cash withdrawal above ₹10,00,000 in a day requires a prior day's intimation and Branch Manager
sign-off; the transaction is reported in the daily large-transaction file.
2.3 Soiled and mutilated note exchange follows the RBI Note Refund Rules; no customer may be refused,
and the exchange is free.
2.4 Coin acceptance may not be refused. Counters accept coins of every denomination in legal tender.

3. CHEQUE AND CLEARING
3.1 Cheques received up to 15:00 are sent in the same day's CTS session; later cheques go the next day.
3.2 A dishonoured cheque is advised to the customer the same day with the return reason; the return memo
is issued free of charge.
3.3 Positive Pay confirmation is required for cheques of ₹5,00,000 and above.

4. CUSTOMER SERVICE OBLIGATIONS
4.1 The Nodal Officer's name and contact and the Ombudsman's details are displayed at the entrance and
at every counter, in English, Hindi and the local language.
4.2 The interest rate card, the service charge schedule and the holiday list are displayed and current.
4.3 A complaint is entered in the complaint register or the CRM the same day, with an acknowledgement
handed to the customer.

5. FORMS AND PROHIBITED PRACTICES
5.1 No customer is asked to bring a photocopy the branch can take itself; no OVD original is retained.
5.2 Cross-selling at a service counter is not permitted; leads are recorded only on the customer's
initiative and never as a condition of service.
5.3 No transaction is processed on a signed blank form.

6. DAY-END CONTROL
Cash balance tallied and vault entry signed by two authorised officers; exception log closed; all
customer complaints of the day escalated if unresolved.`,

  'Health Claim Adjudication SOP.md': `HEALTH CLAIM ADJUDICATION — STANDARD OPERATING PROCEDURE
Claims · Health Indemnity · Version 4.4 · IRDAI-aligned

1. INTAKE AND REGISTRATION
1.1 A claim is registered within 24 hours of intimation with a claim number, policy number, member id,
hospital name and provisional diagnosis.
1.2 Intimation timelines: planned hospitalisation 48 hours before admission; emergency within 24 hours
of admission. Delay beyond this requires a written reason and does not by itself repudiate the claim.

2. DOCUMENT SET
Claim form Part A (insured) and Part B (hospital); discharge summary; final hospital bill with
itemisation; payment receipts; investigation reports; implant invoice and sticker where applicable;
KYC of the payee and cancelled cheque; for accident cases, the FIR or medico-legal certificate.

3. ADJUDICATION SEQUENCE
Step 1 — policy in force on the date of admission; premium paid; member covered.
Step 2 — waiting periods: 30-day initial waiting period; 24 or 48 months for listed ailments; 36 months
for pre-existing disease disclosure, counted from first policy inception where cover is continuous.
Step 3 — admissibility: is the treatment medically necessary and does it require hospitalisation of at
least 24 hours, or is it a listed day-care procedure.
Step 4 — apply sub-limits: room rent, ICU, disease-wise caps, and proportionate deduction where the
room category exceeds entitlement.
Step 5 — apply co-payment and deductible in the order stated in the policy schedule.
Step 6 — deduct non-payable items per the IRDAI standard exclusions list.

4. COMMON NON-PAYABLE ITEMS
Registration and admission charges; toiletries and consumables not linked to the procedure; attendant
and visitor charges; telephone, television and internet; documentation and record charges; food for
attendants; ambulance beyond the policy limit.

5. TURNAROUND AND SETTLEMENT
5.1 Cashless pre-authorisation decided within 60 minutes of receiving a complete request.
5.2 Reimbursement decided within 15 days of receiving the last necessary document.
5.3 Payment released within 7 days of approval; delay beyond that attracts interest at the bank rate
plus 2% as required by regulation.
5.4 A query is raised once, consolidated. Repeated piecemeal queries are a process breach.

6. REPUDIATION AND REVIEW
6.1 A repudiation letter states the exact policy clause, the facts relied on, and the grievance route
including the Insurance Ombudsman.
6.2 Every repudiation above ₹1,00,000 is reviewed by the Claims Committee before dispatch.`,

  'Cashless Pre-Authorisation Turnaround Rules.md': `CASHLESS PRE-AUTHORISATION — TURNAROUND RULES
Claims · Provider Network · Version 3.1

1. WHAT PRE-AUTHORISATION DECIDES
Whether the estimated treatment is admissible under the policy, and up to what amount the insurer will
settle directly with the network hospital. It is not a guarantee of the final bill.

2. TURNAROUND COMMITMENTS
2.1 Planned admission: decision within 60 minutes of a complete request received on the provider portal.
2.2 Emergency admission: initial decision within 60 minutes; where clinical information is incomplete,
an interim approval of up to ₹50,000 is issued so treatment is not delayed.
2.3 Enhancement request during stay: decision within 60 minutes; a request received after 20:00 is
decided by 08:30 the next morning.
2.4 Discharge approval: final decision within 3 hours of receiving the final bill and discharge summary.
2.5 Every clock starts when the request is COMPLETE. An incomplete request is queried within 30 minutes
with a single consolidated list of what is missing.

3. WHAT A COMPLETE REQUEST CONTAINS
Member id and policy number; treating doctor's name and registration number; provisional diagnosis with
ICD code; proposed line of treatment; estimated cost broken into room, professional fees, investigations,
consumables and implants; expected length of stay; date of first symptom.

4. DECISION OUTCOMES
Approved (amount and validity stated) · Approved with deduction (each deduction referenced to a clause)
· Query raised (single consolidated list) · Denied (clause cited, with the grievance route).
An approval is valid for 15 days for a planned admission.

5. ESCALATION
5.1 A pre-authorisation pending beyond 90 minutes is escalated to the Claims Manager automatically.
5.2 A hospital may escalate on the provider helpline; the escalation is logged with a response
commitment of 30 minutes.
5.3 Denials at pre-authorisation are reviewed the same day by a second medical officer where the
estimated amount exceeds ₹2,00,000.

6. NETWORK DISCIPLINE
6.1 The agreed tariff governs. A hospital billing above the agreed tariff is settled at tariff and the
difference is not passed to the member.
6.2 Any demand for a cash deposit from a member on an approved cashless claim is a network breach and is
recorded against the hospital's empanelment.`,

  'Life Underwriting Manual — Medical Grid.md': `LIFE UNDERWRITING MANUAL — MEDICAL GRID
Underwriting · Individual Life · Version 6.3 · Effective 01 April 2026

1. NON-MEDICAL LIMITS BY AGE (sum assured up to which no medical tests are required)
Age 18-35: ₹75,00,000. Age 36-45: ₹50,00,000. Age 46-50: ₹25,00,000.
Age 51-55: ₹10,00,000. Age above 55: nil — full medicals in every case.
Limits apply to total in-force sum assured with this insurer, not to the single proposal.

2. TEST GRID BY SUM ASSURED (cumulative)
Above the non-medical limit: medical examination report, ECG, complete blood count, fasting blood sugar,
lipid profile, liver and renal panel, urine analysis including cotinine.
Above ₹1,00,00,000: add HbA1c, TMT (age 41+), chest X-ray.
Above ₹2,50,00,000: add 2D echocardiogram, HIV/HBsAg/HCV with consent, and a senior underwriter review.
Above ₹5,00,00,000: add a physician's detailed report and a financial underwriting file.

3. RATING GUIDANCE — INDICATIVE EXTRA MORTALITY
Body mass index 30.0-34.9: +50% · 35.0-39.9: +100% · 40 and above: decline pending weight reduction.
Controlled hypertension on single drug, BP under 140/90: standard. On two drugs or BP above 160/100:
+75% and a cardiology opinion.
Type 2 diabetes, HbA1c under 7.0, duration under 5 years, no complication: +75%.
HbA1c 7.0-8.0: +150%. Above 8.0 or any end-organ damage: individual consideration, usually decline.
Current tobacco use: smoker rates apply. Cotinine positive on a non-smoker declaration: proposal is
re-rated as smoker and the discrepancy is recorded.
Cardiac event within 12 months, active malignancy, or uncontrolled psychiatric illness: postpone.

4. FAMILY AND OCCUPATIONAL FACTORS
Two or more first-degree relatives with cardiac or oncological disease before age 60: +25% below age 45.
Hazardous occupation (mining, offshore, explosives, professional diving): flat extra of ₹2 to ₹6 per
₹1,000 sum assured, and accidental benefit riders excluded.

5. DECISION AUTHORITY
Standard and up to +100%: Underwriter. +101% to +200% or any exclusion: Senior Underwriter.
Above +200%, postponement, or decline: Chief Underwriter. Reinsurance referral above ₹5,00,00,000 or any
substandard case above ₹2,50,00,000.

6. DISCLOSURE DISCIPLINE
Non-disclosure of a material fact is assessed against Section 45 of the Insurance Act. Every adverse
decision records the medical evidence relied on and is communicated to the proposer in writing with the
route to a second opinion.`,

  'Sum-Assured Limits & Financial Underwriting.md': `SUM-ASSURED LIMITS AND FINANCIAL UNDERWRITING
Underwriting · Individual Life · Version 4.2

1. HUMAN LIFE VALUE MULTIPLES (maximum sum assured as a multiple of annual income)
Age 18-30: 25x · 31-40: 20x · 41-45: 15x · 46-50: 12x · 51-55: 10x · 56 and above: 6x.
For a homemaker with no independent income, cover is capped at 50% of the earning spouse's in-force
cover, maximum ₹50,00,000.

2. INCOME PROOF BY SUM ASSURED
Up to ₹50,00,000 — latest ITR or Form 16, or three months' salary slips.
₹50,00,001 to ₹2,00,00,000 — ITR for two years with computation, and bank statement for six months.
Above ₹2,00,00,000 — ITR for three years, audited financials where applicable, a net-worth statement
certified by a chartered accountant, and a personal financial questionnaire.

3. NON-EARNING AND SPECIAL CATEGORIES
3.1 Student aged 18-25: maximum ₹25,00,000, on parental income and only where the parent is insured.
3.2 Agriculturist: land holding record required; income assessed at the district-notified yield; maximum
15x with a cap of ₹1,00,00,000.
3.3 Non-resident Indian: country of residence must be in the accepted list; cover in INR only; income
proof from the country of employment with a certified translation.

4. FINANCIAL UNDERWRITING TRIGGERS
Sum assured out of proportion to declared income or lifestyle; premium exceeding 25% of declared annual
income; recent large increase in cover across insurers; a policy proposed by a third party as payer;
key-person cover without a board resolution. Any trigger requires a written justification of need on file.

5. INSURABLE INTEREST
Cover on another person is permitted only for spouse, parent, child, employer-employee (key person),
partner (partnership), or creditor to the extent of the debt. A creditor's cover may not exceed the
outstanding loan plus 12 months' interest.

6. ANTI-MONEY-LAUNDERING INTERFACE
6.1 Single premium above ₹10,00,000, or annual premium above ₹5,00,000, requires source-of-funds
declaration and enhanced due diligence.
6.2 Premium paid by a third party is accepted only from a spouse, parent or child, with relationship
proof, and never in cash above ₹50,000.
6.3 Any proposal where the proposer declines to explain the source of funds is declined and reported to
the Principal Officer.`,

  'Policy Servicing SOP — Endorsements & Revival.md': `POLICY SERVICING SOP — ENDORSEMENTS AND REVIVAL
Operations · Policyholder Servicing · Version 5.0

1. ENDORSEMENT CATEGORIES AND TURNAROUND
Non-financial (name spelling, address, contact, nominee change): 3 working days.
Financial (sum assured, mode of premium, rider addition/deletion): 7 working days, underwriting referral
where risk changes.
Assignment or transfer of title: 7 working days, on receipt of the assignment deed and witness.
Duplicate policy document: 5 working days, on indemnity and the fee stated in the tariff.

2. DOCUMENTS BY REQUEST TYPE
Name correction: OVD showing the correct name plus an affidavit where the change is substantive.
Date-of-birth correction: school leaving certificate, passport or birth certificate; a DOB change that
alters the premium requires payment of the difference with interest from inception.
Nominee change: signed nomination form; consent of the assignee where the policy is assigned.
Bank account change for payout: cancelled cheque with printed name plus IFSC (11 characters, e.g.
HDFC0001234, where characters 5-11 identify the branch) and a bank statement first page.

3. GRACE PERIOD AND LAPSE
3.1 Grace period is 15 days for monthly mode and 30 days for quarterly, half-yearly and annual modes.
3.2 Cover continues during the grace period. A claim during grace is payable after deducting the due
premium.
3.3 Non-payment after grace makes the policy lapse. A lapsed policy with fewer than two years' premiums
paid acquires no surrender value; with two years or more it becomes a reduced paid-up policy where the
product allows.

4. REVIVAL
4.1 Revival is permitted within five years of the first unpaid premium.
4.2 Ordinary revival (within 6 months): arrears plus interest at the declared revival rate, no fresh
declaration of health.
4.3 Revival after 6 months: arrears with interest, a declaration of good health, and underwriting review;
medical tests where the sum at risk exceeds the non-medical limit for the current age.
4.4 Revival is an underwriting decision, not a right. A declined revival is communicated in writing with
the medical or financial reason.
4.5 Suicide and other clause-based exclusions restart from the date of revival where the product terms
so provide.

5. FREE-LOOK AND CANCELLATION
5.1 Free-look is 30 days from receipt of the policy document. Refund is premium less proportionate risk
premium, medical expenses and stamp duty.
5.2 Surrender is processed within 7 working days of a complete request, with the surrender value working
shown to the policyholder.

6. SERVICE DISCIPLINE
Every request is acknowledged with a service request number the same day. A request pending beyond its
turnaround is escalated automatically and reported in the monthly service pack.`,

  'IRDAI Grievance Turnaround Commitments.md': `GRIEVANCE REDRESSAL — TURNAROUND COMMITMENTS
Customer Service · Aligned to the IRDAI Protection of Policyholders' Interests Regulations · Version 3.2

1. WHAT COUNTS AS A GRIEVANCE
Any expression of dissatisfaction about a product, service, claim decision or the conduct of an
intermediary. A request for information is a service request, not a grievance, and is not recorded as one
to reduce numbers.

2. COMMITTED TIMELINES
Acknowledgement: within 3 working days of receipt, with a unique grievance reference.
Resolution or rejection with reasons: within 14 days of receipt.
Where the grievance requires a claim re-examination: 14 days, extendable once to 30 days with written
intimation to the complainant explaining why.
Closure intimation: the complainant is told the outcome, the reason, and the next escalation available.

3. CHANNELS
Branch and service desk · toll-free helpline · the grievance email address published on every policy
document · the insurer's portal · the IRDAI Bima Bharosa portal. A grievance received on any channel
enters the same register within one working day.

4. ESCALATION LADDER
Level 1 — Service Manager at the servicing office.
Level 2 — Grievance Redressal Officer, named on the website with a direct email and telephone number.
Level 3 — Insurance Ombudsman, where the grievance is unresolved after 30 days, or the complainant is
dissatisfied with the resolution. The Ombudsman's territorial office and address are stated in every
rejection letter.
The complainant is never required to exhaust an internal level before approaching the Ombudsman once
30 days have passed.

5. RECORD AND ROOT CAUSE
5.1 The register records date of receipt, channel, category, policy number, resolution date, outcome and
the root cause code.
5.2 Categories with repeat volume are reported to the Policyholder Protection Committee each quarter with
a corrective action owner and a date.
5.3 Turnaround breaches are reported by name of the owning function; a breach is never closed by
back-dating an entry.

6. COMMUNICATION STANDARD
Every rejection states the specific policy clause, the facts relied on, and the Ombudsman route in plain
language, in the language of the policy document. No rejection is communicated only by telephone.`,

  'Motor FNOL Intake Script & Mandatory Fields.md': `MOTOR FNOL — INTAKE SCRIPT AND MANDATORY FIELDS
Claims · Motor Own Damage and Third Party · Version 4.1

1. OPENING (read as written)
"You have reached the claims desk. I am sorry to hear about the incident. First — is anyone injured and
does anyone need medical help right now?"
If yes: give the emergency number, confirm the location, register the claim as a medico-legal case, and
tell the caller a claims officer will call back within 30 minutes.

2. MANDATORY FIELDS — a claim is not registered without these
Policy number and vehicle registration number; date, time and place of loss (with landmark);
name and mobile of the caller and their relationship to the insured; name of the person driving at the
time; driving licence number of that person and its validity; description of the incident in the
caller's own words; whether a third party is involved (person, vehicle or property); whether the police
were informed and the FIR number if available; current location of the vehicle and whether it is
drivable; the garage the insured prefers, if any.

3. NEVER PROMISED ON THE CALL
Admissibility of the claim; the amount payable; the depreciation or salvage position; a repair timeline;
"cashless" without confirming the garage is in network for that city.

4. IMMEDIATE ACTIONS BY BAND
Estimated loss up to ₹25,000, drivable, no third party: register, issue the claim number, direct to a
network garage, no surveyor required — assessment on uploaded photographs.
₹25,001 to ₹1,00,000: allocate a surveyor within 4 hours, spot survey within 24 hours.
Above ₹1,00,000, or total loss suspected, or theft, or any third-party injury: allocate a senior surveyor
within 2 hours, notify the Claims Manager, and open an investigation file.

5. THEFT AND TOTAL LOSS
Theft requires the FIR, the RC, both keys, and the non-traceable certificate before settlement. Total
loss is settled on the Insured Declared Value less the salvage where salvage is retained by the insured.

6. CLOSING (read as written)
"Your claim number is {{claim_no}}. You will receive an SMS on {{mobile}} with this number and the next
step. Please do not begin repairs before the survey — repairs started before survey may not be payable.
Do you have any question about what happens next?"
Every call is logged with the claim number, the fields captured, and the advice given.`,

  'Surveyor Allocation & Own-Damage Assessment SOP.md': `SURVEYOR ALLOCATION AND OWN-DAMAGE ASSESSMENT SOP
Claims · Motor · Version 3.8

1. ALLOCATION RULES
1.1 Allocation is automatic by pin code, loss band and surveyor availability, in that order. Manual
override requires a reason code and is reported weekly.
1.2 Turnaround: allocation within 2 hours of registration in metros and 4 hours elsewhere; spot survey
within 24 hours; survey report within 72 hours of survey.
1.3 A surveyor may not be allocated to a claim where the garage, the insured or the driver is a related
party; the conflict declaration is part of the acceptance.
1.4 Only surveyors holding a valid IRDAI licence for the class and within their sanctioned limit are
allocated. Licence expiry blocks allocation automatically.

2. SPOT SURVEY CONTENT
Photographs: four corners of the vehicle, close-up of every damaged panel, odometer, chassis number
plate, registration plate, and the driver's licence.
Verification: registration number against the RC; engine and chassis numbers; nature of damage against
the reported cause of loss; presence of any old, unrepaired damage.
Statement: the driver's account of the incident, recorded and signed.

3. ASSESSMENT AND DEPRECIATION
3.1 Parts depreciation by age of vehicle: up to 6 months nil; 6 months-1 year 5%; 1-2 years 10%;
2-3 years 15%; 3-4 years 25%; 4-5 years 35%; 5-10 years 40%; above 10 years 50%.
3.2 Rubber, nylon, plastic parts, tyres, tubes and batteries: 50% flat. Fibreglass components: 30%.
Glass: nil depreciation.
3.3 Labour is assessed at the network tariff for the city; painting is assessed by panel count, not by
invoice value.
3.4 Betterment is deducted where a replacement improves the pre-accident condition.

4. TOTAL LOSS AND CONSTRUCTIVE TOTAL LOSS
Where the assessed repair cost plus salvage recovery exceeds 75% of the Insured Declared Value, the claim
is settled as a constructive total loss. Salvage is disposed through the approved salvage-buyer panel;
where the insured retains salvage, the assessed salvage value is deducted.

5. RE-INSPECTION
Mandatory re-inspection after repair for claims above ₹1,00,000, for every replaced airbag, and on a
5% random sample of all other claims. A re-inspection mismatch stops the payment and opens an enquiry.

6. QUALITY CONTROL
Reports are audited on a 10% sample. Recurring under- or over-assessment beyond 10% variance leads to
de-panelment review. Every deduction in a report must cite the policy clause or the depreciation table
row it comes from.`,

  'Indemnity Claim Assessment SOP.md': `INDEMNITY CLAIM ASSESSMENT SOP
Claims · Health Indemnity · Version 4.0

1. PRINCIPLE
Indemnity restores the insured to the financial position before the loss, within the limits of the
policy. Nothing more is payable, and nothing admissible is withheld. Every deduction is traceable to a
clause or a tariff row.

2. ASSESSMENT SEQUENCE
2.1 Establish cover: policy in force, member listed, premium realised, waiting periods satisfied.
2.2 Establish medical necessity: was hospitalisation required, was the line of treatment appropriate,
was the duration of stay justified by the clinical record.
2.3 Establish quantum: itemise the bill into room and nursing, ICU, professional fees, investigations,
pharmacy and consumables, implants, and other charges.
2.4 Apply entitlements in order: room-rent eligibility and proportionate deduction, disease sub-limits,
implant caps, then co-payment, then deductible.
2.5 Apply exclusions and non-payables. Reconcile to the sum insured and any cumulative bonus.

3. PROPORTIONATE DEDUCTION
Where the room category taken exceeds the entitlement, associated charges that vary with room category
(nursing, professional fees, operation theatre) are reduced in the ratio of the entitled room rent to
the room rent actually charged. Pharmacy, implants and investigations are NOT proportionately reduced.

4. EVIDENCE STANDARDS
Original itemised bill and payment receipt; discharge summary naming the diagnosis and the procedure;
all investigation reports referenced in the summary; implant invoice with lot number and sticker;
prescription for every pharmacy line. A pharmacy bill without a prescription is not payable.

5. FRAUD INDICATORS REQUIRING INVESTIGATION
Admission within 45 days of policy inception for a chronic condition; multiple claims from one hospital
with identical bill patterns; length of stay not supported by the clinical notes; bill numbers out of
sequence; investigations dated after discharge; a hospital not registered under the Clinical
Establishments Act.

6. DECISION AND COMMUNICATION
6.1 Settlement letter shows the claimed amount, each deduction with its clause reference, and the net
payable. A settlement with unexplained deductions is a process breach.
6.2 Turnaround: 15 days from the last necessary document; payment within 7 days of approval.
6.3 Every claim over ₹5,00,000 and every repudiation over ₹1,00,000 is peer-reviewed before dispatch.`,

  'Room-Rent & Sub-Limit Application Guide.md': `ROOM-RENT AND SUB-LIMIT APPLICATION GUIDE
Claims · Health Indemnity · Version 2.9

1. ROOM-RENT ENTITLEMENT BY PLAN
Plan A (sum insured ₹3,00,000-₹5,00,000): shared room; room rent capped at 1% of sum insured per day;
ICU capped at 2% per day.
Plan B (₹5,00,001-₹10,00,000): single private room, no monetary cap on room rent; ICU at actuals.
Plan C (above ₹10,00,000): single private room or above, ICU at actuals, no proportionate deduction.
Suite and deluxe categories are outside entitlement in every plan.

2. WORKED EXAMPLE OF PROPORTIONATE DEDUCTION
Sum insured ₹5,00,000, entitlement ₹5,000 a day. Room actually taken ₹8,000 a day. Ratio = 5,000/8,000
= 62.5%.
Associated charges linked to room category — nursing ₹12,000, surgeon's fee ₹60,000, operation theatre
₹25,000 — are payable at 62.5%: ₹7,500 + ₹37,500 + ₹15,625.
Pharmacy ₹18,000, investigations ₹14,000 and the implant ₹85,000 are paid in full, subject to their own
caps. Room rent itself is paid at the entitled ₹5,000 a day.

3. DISEASE-WISE SUB-LIMITS (Plan A and B, per claim)
Cataract: ₹40,000 per eye. Knee replacement: ₹2,00,000 per knee. Hernia: ₹60,000.
Hysterectomy: ₹75,000. Angioplasty including stent: ₹2,50,000. Dialysis: ₹5,000 per session.
Where a sub-limit applies, it is the ceiling for the entire episode including room, professional fees
and consumables.

4. OTHER LIMITS THAT APPLY BEFORE THE SUM INSURED
Ambulance: ₹3,000 per hospitalisation. Pre-hospitalisation: 30 days. Post-hospitalisation: 60 days.
Domiciliary hospitalisation: up to 10% of sum insured, only where hospitalisation was advised but a bed
was unavailable or the patient could not be moved.
Modern treatment methods (robotic surgery, oral chemotherapy, stem cell therapy): 50% of sum insured.

5. ORDER OF APPLICATION
Room-rent proportionate deduction → disease sub-limit → non-payable items → co-payment → deductible →
sum insured and cumulative bonus. Applying co-payment before the sub-limit understates the payable and
is a common assessment error.

6. WHAT MAY NEVER BE DEDUCTED TWICE
A charge reduced by proportionate deduction is not reduced again under a sub-limit; the lower of the two
outcomes applies once. Every settlement sheet shows the order in which limits were applied.`,
};
