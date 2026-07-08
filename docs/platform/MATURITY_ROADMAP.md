# Off Grid AI — platform maturity roadmap ("what's next")

The [platform spine](./PLATFORM.md) governs + composes. These six close the gaps between "governs beautifully" and "compounds + earns enterprise trust." Stack-ranked; built **sequentially**.

## M1 — Close the loop (BIGGEST) — detect → act → learn
Today evals/drift/quality DETECT but nothing ACTS. Make the platform a flywheel:
- **Act:** on eval-gate fail or drift breach → **auto-rollback** the pipeline to its last-good published version (versioning exists — wire it to act) + alert. A "release gate" on publish: a version only goes live if it clears its evals.
- **Learn:** capture **HITL corrections + chat thumbs** as labeled eval/golden data → the next run is measured against real feedback. Usage improves the pipeline.
- Surfaces: pipeline Quality tab shows gate status + rollback history; a feedback→golden pipe.

## M2 — Lifecycle & ownership above the pipeline
- **Owner** per pipeline; **teams/BU** tier between org and pipeline (RBAC delegated).
- **Promotion gate:** draft → eval-gated → **published** (requires approver) → deprecated. No plain-language pipeline hits prod without sign-off. (Ties to M1's release gate.)

## M3 — Capacity control + control-plane HA
- **GPU/capacity scheduling:** per-pipeline/team quota, priority, admission control + backpressure when the fixed fleet is saturated (dollars aren't the scarce resource — GPU is).
- **S1 SPOF → HA:** use S2 as warm standby for the control plane (console + DB replication + failover). DR beyond backups.

## M4 — Deep data governance (for the warehouse ambition)
- **Data catalog** (what data exists), classification, **retention / right-to-be-forgotten** propagated across warehouse + vector store + lineage.
- **Freshness SLAs + broken-sync alerting** (silent bad sync → wrong exec dashboards).

## M5 — The platform runs itself (the AI moat)
- **Ops copilot:** "why did this run fail / why is cost up / what's drifting" over the spine.
- Auto-suggest guardrails/evals for a new pipeline; auto-generate data-quality expectations from schema; anomaly detection (not fixed thresholds). Differentiator vs. "a pile of OSS containers."

## M6 — Citizen of existing stacks (not an island)
- Export **audit → Splunk, lineage → Purview/Collibra, metrics → Grafana** (OTLP/standards). IdP federation already done (Keycloak). "Bring your own observability/catalog."

**Order:** M1 → M2 → M3 → M4 → M5 → M6, sequential. M1+M2 couple (release gate). Data plane (Airbyte/ClickHouse on S2) runs as its own track feeding M4.
