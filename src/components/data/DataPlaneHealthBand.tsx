import { Card, CardContent } from '@/components/ui/card';
import { getServices } from '@/lib/services-directory';
import { probeEntry } from '@/lib/status';
import { deriveDataPlaneHealth, DATA_PLANE_ENGINES } from '@/lib/dataplane-ui';

// Compact data-plane engine-health band (server component). Probes only the four data-plane
// services through the shared probe, then renders their up/down in PRODUCT language (Pipelines /
// Streaming / Warehouse / Data quality) — never the engine names. Degrades to 'Unknown' (not a
// scary red) when a probe can't resolve. Reused at the top of the Data home + surfaces.
export async function DataPlaneHealthBand() {
  const wanted = new Set(DATA_PLANE_ENGINES.map((e) => e.serviceId));
  const services = getServices().filter((s) => wanted.has(s.id));
  const probes = await Promise.all(services.map((s) => probeEntry(s)));
  const views = deriveDataPlaneHealth(probes.map((p) => ({ id: p.id, status: p.status })));

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {views.map((v) => (
        <Card key={v.serviceId} className="shadow-sm">
          <CardContent className="flex items-start justify-between gap-2 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{v.label}</div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{v.blurb}</p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${v.tone}`}
              aria-label={`${v.label}: ${v.stateLabel}`}
            >
              {v.stateLabel}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
