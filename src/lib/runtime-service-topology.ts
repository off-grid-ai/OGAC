import {
  createServiceTopologyRegistry,
  parseServiceTopologyRecords,
  type ServiceTopologyRegistry,
} from './adapters/service-topology-registry';
import { getServices } from './services-directory';

/** Server-owned production adapter. Deployment topology is supplied by the fleet configuration. */
export function getRuntimeServiceTopologyRegistry(
  env: Record<string, string | undefined> = process.env,
): ServiceTopologyRegistry {
  return createServiceTopologyRegistry({
    listServices: getServices,
    listTopologyRecords: () => parseServiceTopologyRecords(env.OFFGRID_SERVICE_TOPOLOGY),
  });
}
