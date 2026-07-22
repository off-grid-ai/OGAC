import { getRuntimeServiceTopologyRegistry } from './runtime-service-topology';
import { SERVICE_CAPABILITY_AUDITS } from './service-capability-map';
import {
  buildReadinessByService,
  consoleUsedEvidence,
  mergeReadinessEvidence,
} from './service-readiness-probe';
import type { LogicalServiceTopology } from './service-topology';
import { computeStatus } from './status';

// Service ids with ≥1 capability whose workflow gate is verified — i.e. a production workflow through
// the service is proven. Used to attest the `console-used` readiness gate (evidence-backed).
function servicesWithProvenWorkflow(): Set<string> {
  const ids = new Set<string>();
  for (const audit of SERVICE_CAPABILITY_AUDITS) {
    if (audit.items.some((item) => item.gates.workflow.status === 'yes')) ids.add(audit.serviceId);
  }
  return ids;
}

// Server helper (I/O). Enrich each service's deployment topology with a LIVE health-probe readiness
// verdict (deployed / reachable / functional) so the Service capability map's list badge reflects
// real health instead of a permanent "unverified" baseline. Reuses computeStatus() — the exact same
// probe behind /api/v1/status — so there is one source of truth for liveness.
//
// FAIL HONEST: if the probe batch throws, return the untouched baseline topology (services read
// "unverified"), never a fabricated pass.
export async function listLiveServiceTopologies(): Promise<LogicalServiceTopology[]> {
  const topologies = getRuntimeServiceTopologyRegistry().list();
  const provenWorkflow = servicesWithProvenWorkflow();
  try {
    const status = await computeStatus();
    const observedAt = status.checkedAt;
    const byService = buildReadinessByService(
      status.services.map((s) => ({ id: s.id, status: s.status, ms: s.ms ?? undefined })),
      observedAt,
    );
    return topologies.map((topology) => {
      const live = [
        ...(byService.get(topology.service.id) ?? []),
        ...consoleUsedEvidence(provenWorkflow.has(topology.service.id), observedAt),
      ];
      return live.length > 0
        ? { ...topology, readiness: mergeReadinessEvidence(topology.readiness, live) }
        : topology;
    });
  } catch {
    return topologies;
  }
}
