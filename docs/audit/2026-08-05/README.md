# Console audit — 2026-08-05

One team per console section: the section's specialists + Principal UX / UI / Usability / QA / QC.
Each team writes its own file in this directory **as it works**, not at the end.

**Why append-as-you-go:** the first run of this audit lost five of nine teams to a session limit, and
every finding they had gathered died with them. A report that only exists in an agent's context is not
a report. So each team's file is the durable artefact — incomplete is fine, lost is not.

| File | Section | Status |
| --- | --- | --- |
| `governance.md` | Governance (36p) | complete |
| `insights.md` | Insights (40p) | complete |
| `operations-observability.md` | Operations — logs/traces/metrics/alerts | complete |
| `gateway.md` | Gateway registry / services / fleet | complete |
| `data.md` | Data + Storage (41p) | in progress |
| `runtime.md` | AI Runtime (23p) | in progress |
| `solutions-build.md` | Solutions + Build (88p) | in progress |
| `work-workspace.md` | Work + Workspace (24p) | in progress |
| `operations.md` | Operations — services / capability map / backups | in progress |

Severity: **BLOCKER** = ships a false claim, data loss, or a cross-tenant/privilege escalation ·
**MAJOR** = a persona cannot complete their job · **MINOR** = friction or polish.
