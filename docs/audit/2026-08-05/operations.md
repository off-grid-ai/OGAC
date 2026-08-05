# Audit — Operations (excluding observability) — 2026-08-05

Section: `src/app/(console)/operations/**` minus logs/traces/metrics/alerts and minus
`operations/services` + `operations/devices` (covered by sibling teams). Focus: capability map,
runs, physical nodes, edge, configuration, backups/DR drills, admin, and the
service-inventory/health/status libs underneath.

Central question: **can an operator trust this section's picture of the platform?**

Status: IN PROGRESS — findings appended as confirmed.

## Coverage so far

- [ ] status.ts / service-health.ts / service-inventory.ts (truthfulness of the probe)
- [ ] services-directory.ts, service-specs.ts, service-probes.ts
- [ ] capability map (`operations/services/capability-map`, service-capability-map.ts)
- [ ] runs (`operations/runs`)
- [ ] nodes (`operations/nodes`, clusters)
- [ ] edge
- [ ] configuration
- [ ] backups / DR drills
- [ ] admin
- [ ] screenshots read + judged

## Findings

(none yet)
