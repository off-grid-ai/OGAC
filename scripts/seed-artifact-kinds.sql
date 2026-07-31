-- ─── Artifacts of every renderable KIND ────────────────────────────────────────────────────────────
--
-- All 112 seeded artifacts were kind='code', so the Artifacts surface — whose own copy promises "an HTML
-- page, SVG, React component, diagram, or code block" — could only ever demonstrate one of the five. The
-- live-thumbnail path (HTML/SVG/React) was never exercised at all.
--
-- Content is real BFSI material rather than lorem, because a reviewer opens these.
INSERT INTO chat_artifacts (id, org_id, user_id, conversation_id, title, kind, language, code,
                            code_key, code_hash, current_version, published, created_at, updated_at)
SELECT 'art_k_' || substr(md5(a.title || u.email || o.org), 1, 12), o.org, u.email,
       (SELECT id FROM chat_conversations cv WHERE cv.org_id = o.org AND cv.user_id = u.email LIMIT 1),
       a.title, a.kind, a.language, a.code,
       'ak_' || substr(md5(a.title), 1, 10), substr(md5(a.code), 1, 16), 1, a.pub, now(), now()
FROM (VALUES
  ('90-DPD Recovery Dashboard', 'html', 'html',
   '<section style="font-family:Menlo,monospace;padding:16px">'
   || '<h2 style="margin:0 0 4px">90-DPD Recovery — Week 31</h2>'
   || '<p style="color:#555;margin:0 0 12px">Bucket movement and promise-to-pay conversion.</p>'
   || '<table style="border-collapse:collapse;width:100%;font-size:13px">'
   || '<tr style="text-align:left;border-bottom:1px solid #ddd"><th>Bucket</th><th>Accounts</th><th>Exposure</th><th>PTP kept</th></tr>'
   || '<tr><td>90-119 DPD</td><td>412</td><td>&#8377;4,18,20,000</td><td>63%</td></tr>'
   || '<tr><td>120-179 DPD</td><td>188</td><td>&#8377;2,94,60,000</td><td>41%</td></tr>'
   || '<tr><td>180+ DPD</td><td>97</td><td>&#8377;1,77,40,000</td><td>22%</td></tr>'
   || '</table></section>', true),
  ('Claim Triage Decision Flow', 'mermaid', 'mermaid',
   'flowchart TD' || chr(10) ||
   '  A[FNOL received] --> B{Policy in force?}' || chr(10) ||
   '  B -- No --> R[Repudiate with reason]' || chr(10) ||
   '  B -- Yes --> C{Documents complete?}' || chr(10) ||
   '  C -- No --> D[Request deficiency]' || chr(10) ||
   '  C -- Yes --> E{Within sub-limits?}' || chr(10) ||
   '  E -- No --> F[Assess excess to policyholder]' || chr(10) ||
   '  E -- Yes --> G{Amount > approval limit?}' || chr(10) ||
   '  G -- Yes --> H[Escalate to manager]' || chr(10) ||
   '  G -- No --> I[Settle]', true),
  ('Exposure by Bucket', 'svg', 'svg',
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140" width="320" height="140">'
   || '<rect width="320" height="140" fill="#fff"/>'
   || '<rect x="30" y="30" width="170" height="22" fill="#059669"/>'
   || '<rect x="30" y="62" width="120" height="22" fill="#34D399"/>'
   || '<rect x="30" y="94" width="72" height="22" fill="#A7F3D0"/>'
   || '<text x="30" y="22" font-family="Menlo" font-size="11">Exposure by DPD bucket (&#8377; Cr)</text>'
   || '<text x="208" y="46" font-family="Menlo" font-size="10">4.18</text>'
   || '<text x="158" y="78" font-family="Menlo" font-size="10">2.94</text>'
   || '<text x="110" y="110" font-family="Menlo" font-size="10">1.77</text>'
   || '</svg>', true),
  ('Re-KYC Progress Card', 'react', 'tsx',
   'export default function ReKycProgress() {' || chr(10) ||
   '  const rows = [' || chr(10) ||
   '    { segment: ''High risk'', due: 412, done: 374 },' || chr(10) ||
   '    { segment: ''Medium risk'', due: 1180, done: 902 },' || chr(10) ||
   '    { segment: ''Low risk'', due: 3640, done: 3115 },' || chr(10) ||
   '  ];' || chr(10) ||
   '  return (' || chr(10) ||
   '    <div className="font-mono text-sm">' || chr(10) ||
   '      <h3 className="mb-2 font-semibold">Periodic re-KYC — quarter to date</h3>' || chr(10) ||
   '      {rows.map((r) => (' || chr(10) ||
   '        <div key={r.segment} className="flex justify-between border-b py-1">' || chr(10) ||
   '          <span>{r.segment}</span>' || chr(10) ||
   '          <span>{r.done}/{r.due} ({Math.round((r.done / r.due) * 100)}%)</span>' || chr(10) ||
   '        </div>' || chr(10) ||
   '      ))}' || chr(10) ||
   '    </div>' || chr(10) ||
   '  );' || chr(10) || '}', false),
  ('Fair-Practice Dunning Notice', 'markdown', 'markdown',
   '# Outstanding balance — account ending 4471' || chr(10) || chr(10) ||
   'Dear Policyholder,' || chr(10) || chr(10) ||
   'Our records show an outstanding balance of **₹3,11,500** on the account ending 4471, now 96 days '
   || 'past due.' || chr(10) || chr(10) ||
   '## Options available to you' || chr(10) || chr(10) ||
   '- Settle in full and close the arrears' || chr(10) ||
   '- Restructure over 6 or 12 months' || chr(10) ||
   '- Request a hardship review with documentation' || chr(10) || chr(10) ||
   '> Issued under the RBI Fair Practices Code. No coercive language, no third-party disclosure, '
   || 'and contact only between 08:00 and 19:00.' || chr(10) || chr(10) ||
   '— Collections, Bharat Union Bank', true)
) AS a(title, kind, language, code, pub)
CROSS JOIN (SELECT DISTINCT email FROM "user") u
CROSS JOIN (VALUES ('org_bharat'), ('org_suraksha'), ('default')) o(org)
WHERE EXISTS (SELECT 1 FROM chat_conversations cv WHERE cv.org_id = o.org AND cv.user_id = u.email)
  AND NOT EXISTS (
    SELECT 1 FROM chat_artifacts x
    WHERE x.user_id = u.email AND x.org_id = o.org AND x.title = a.title
  );
