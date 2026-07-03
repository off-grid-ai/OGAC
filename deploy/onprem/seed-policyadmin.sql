-- Policy Admin (MySQL) seed — agents, branches, commissions. Auto-run on first boot.
CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80), region VARCHAR(40), city VARCHAR(40));
CREATE TABLE IF NOT EXISTS agents (
  id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80), branch_id INT, tier VARCHAR(20), active TINYINT);
CREATE TABLE IF NOT EXISTS commissions (
  id INT AUTO_INCREMENT PRIMARY KEY, agent_id INT, policy_ref VARCHAR(20), amount DECIMAL(12,2), paid_on DATE);

INSERT INTO branches (name, region, city)
SELECT CONCAT('Branch ', n), ELT(1+(n%4),'West','North','South','East'),
       ELT(1+(n%6),'Mumbai','Pune','Delhi','Bengaluru','Chennai','Hyderabad')
FROM (SELECT @r:=@r+1 n FROM information_schema.columns, (SELECT @r:=0) x LIMIT 60) t;

INSERT INTO agents (name, branch_id, tier, active)
SELECT CONCAT('Agent ', n), 1+(n%60), ELT(1+(n%3),'gold','silver','bronze'), IF(n%7=0,0,1)
FROM (SELECT @a:=@a+1 n FROM information_schema.columns, (SELECT @a:=0) x LIMIT 850) t;

INSERT INTO commissions (agent_id, policy_ref, amount, paid_on)
SELECT 1+(n%850), CONCAT('POL', LPAD(n,7,'0')), ROUND(500+RAND()*24000,2),
       DATE_ADD('2024-01-01', INTERVAL (n%540) DAY)
FROM (SELECT @c:=@c+1 n FROM information_schema.columns c1, information_schema.columns c2, (SELECT @c:=0) x LIMIT 5200) t;
