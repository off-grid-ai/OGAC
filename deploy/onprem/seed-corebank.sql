-- Core Banking seed — realistic enterprise data for the Off Grid connectors demo.
-- Auto-run by the postgres image on first boot (mounted into docker-entrypoint-initdb.d).
-- Idempotent-ish: guards on empty tables so re-runs don't duplicate.

CREATE TABLE IF NOT EXISTS customers (
  id serial PRIMARY KEY, name text, email text, city text, kyc_status text, created_at date);
CREATE TABLE IF NOT EXISTS policies (
  id serial PRIMARY KEY, customer_id int, product text, premium numeric, sum_insured numeric, status text, start_date date);
CREATE TABLE IF NOT EXISTS claims (
  id serial PRIMARY KEY, policy_id int, amount numeric, status text, filed_at date, category text);
CREATE TABLE IF NOT EXISTS transactions (
  id serial PRIMARY KEY, customer_id int, amount numeric, kind text, ts timestamptz);

INSERT INTO customers (name,email,city,kyc_status,created_at)
SELECT 'Customer '||g, 'cust'||g||'@example.in',
  (ARRAY['Mumbai','Pune','Delhi','Bengaluru','Chennai','Hyderabad'])[1+(g%6)],
  (ARRAY['verified','pending','verified','verified'])[1+(g%4)],
  date '2024-01-01' + (g%600)
FROM generate_series(1,2400) g
WHERE NOT EXISTS (SELECT 1 FROM customers);

INSERT INTO policies (customer_id,product,premium,sum_insured,status,start_date)
SELECT 1+(g%2400),
  (ARRAY['Health Optima','Motor Secure','Home Shield','Travel Guard','Term Life'])[1+(g%5)],
  round((3000+random()*45000)::numeric,2), round((100000+random()*4900000)::numeric,2),
  (ARRAY['active','active','active','lapsed'])[1+(g%4)], date '2024-01-01' + (g%540)
FROM generate_series(1,3800) g
WHERE NOT EXISTS (SELECT 1 FROM policies);

INSERT INTO claims (policy_id,amount,status,filed_at,category)
SELECT 1+(g%3800), round((2000+random()*280000)::numeric,2),
  (ARRAY['approved','pending','rejected','approved','settled'])[1+(g%5)],
  date '2024-06-01' + (g%400),
  (ARRAY['cashless','reimbursement','accident','theft'])[1+(g%4)]
FROM generate_series(1,1450) g
WHERE NOT EXISTS (SELECT 1 FROM claims);

INSERT INTO transactions (customer_id,amount,kind,ts)
SELECT 1+(g%2400), round((100+random()*90000)::numeric,2),
  (ARRAY['premium','payout','refund','fee'])[1+(g%4)],
  now() - (g||' minutes')::interval
FROM generate_series(1,9200) g
WHERE NOT EXISTS (SELECT 1 FROM transactions);
