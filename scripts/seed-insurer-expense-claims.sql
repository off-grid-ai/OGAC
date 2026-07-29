-- ─── Insurer expense claims, derived FROM the insurer's own employee roster ──────────────────────────
--
-- The insurer's `employee_quota` is a different (richer) shape from the bank's: varchar employee ids
-- (EMP00001), a full name, department, grade, manager, and ONE reimbursement pool per employee rather than
-- a per-category entitlement. It already holds 500 real-looking employees, so it is the roster — not
-- something to overwrite.
--
-- The claims are therefore generated IN THE DATABASE from that roster. Every claim's employee id and name
-- come from the quota row it will be checked against, so the two can never disagree — the same property the
-- bank's generator gets from sharing one roster in code.
--
-- Deterministic: CRC32 of the employee id drives every choice, so a re-run produces identical rows.
--
-- RUN: docker exec -i offgrid-ds-policyadmin sh -c 'mysql -uroot -p$MYSQL_ROOT_PASSWORD' < this-file
USE `suraksha`;

DROP TABLE IF EXISTS expense_claims;
CREATE TABLE expense_claims (
  id INT PRIMARY KEY AUTO_INCREMENT,
  claim_no VARCHAR(32) NOT NULL,
  employee_id VARCHAR(16) NOT NULL,
  employee_name VARCHAR(128) NOT NULL,
  department VARCHAR(64) NULL,
  category VARCHAR(32) NOT NULL,
  purpose VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(24) NOT NULL,
  submitted_at DATE NOT NULL,
  fy VARCHAR(16) NOT NULL,
  manager_id VARCHAR(16) NULL,
  source VARCHAR(32) NOT NULL,
  INDEX idx_employee (employee_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Two claims per employee for the first 150 employees: enough open work for the queue to look like a real
-- desk, and repeat employees so a second claim against a part-spent pool is a genuinely different decision.
INSERT INTO expense_claims
  (claim_no, employee_id, employee_name, department, category, purpose, amount, status, submitted_at, fy, manager_id, source)
SELECT
  CONCAT('EXP-2026-', LPAD(ROW_NUMBER() OVER (ORDER BY q.employee_id, n.seq), 5, '0')),
  q.employee_id,
  q.full_name,
  q.department,
  ELT(1 + (CRC32(CONCAT(q.employee_id, n.seq, 'cat')) % 6),
      'Travel', 'Medical', 'Training', 'Communication', 'Relocation', 'Client Entertainment'),
  ELT(1 + (CRC32(CONCAT(q.employee_id, n.seq, 'pur')) % 6),
      'Client visit — Mumbai to Bengaluru',
      'Diagnostic tests — dependent parent',
      'IRDAI compliance certification',
      'Broadband reimbursement — Q1',
      'Transfer travel — Chennai posting',
      'Advisor meet — regional'),
  -- Every 5th claim deliberately EXCEEDS what is left in the pool, so the approver is making a real
  -- decision on real numbers rather than rubber-stamping a queue that always passes.
  GREATEST(1200, ROUND(
    COALESCE(q.quota_remaining_inr, 50000) *
    CASE WHEN (CRC32(CONCAT(q.employee_id, n.seq, 'amt')) % 5) = 0
         THEN 1.15 + (CRC32(CONCAT(q.employee_id, n.seq, 'over')) % 60) / 100
         ELSE 0.15 + (CRC32(CONCAT(q.employee_id, n.seq, 'under')) % 70) / 100 END, 2)),
  ELT(1 + (CRC32(CONCAT(q.employee_id, n.seq, 'st')) % 8),
      'submitted', 'submitted', 'submitted', 'submitted', 'under_review', 'approved', 'rejected', 'paid'),
  DATE_ADD('2025-04-01', INTERVAL (CRC32(CONCAT(q.employee_id, n.seq, 'day')) % 330) DAY),
  q.fiscal_year,
  q.manager_id,
  'sur_seed'
FROM (SELECT * FROM employee_quota WHERE status = 'active' ORDER BY employee_id LIMIT 150) q
CROSS JOIN (SELECT 1 AS seq UNION ALL SELECT 2) n;

GRANT SELECT ON `suraksha`.expense_claims TO 'policyadmin'@'%';
FLUSH PRIVILEGES;

SELECT COUNT(*) AS claims, COUNT(DISTINCT employee_id) AS employees FROM expense_claims;
