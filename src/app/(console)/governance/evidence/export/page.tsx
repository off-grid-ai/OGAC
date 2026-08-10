import { DownloadSimple as Download } from '@phosphor-icons/react/dist/ssr';
import { ExportersSurface } from '@/app/(console)/governance/exporters/content';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// This route is what the buyer-facing one-pager calls "the regulator pack you hand over" — a CISO
// or DPO lands here expecting the artefact that ends a compliance conversation. The download below
// is the real thing (the same one-click regulator-ready pack /governance/regulatory generates), so
// clicking through actually produces it rather than landing on a config screen with nothing on it.
// The exporter targets underneath are a distinct, real feature — streaming the audit/lineage/metrics
// spine into the enterprise's OWN SIEM/catalog/observability stack — kept on this page because it is
// also evidence leaving the platform, just outbound to the buyer's tooling instead of into a PDF.
export default function EvidenceExportPage() {
  return (
    <div className="w-full space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">The regulator pack you hand over</CardTitle>
          <Button asChild size="sm">
            <a href="/api/v1/admin/compliance/export">
              <Download className="size-4" />
              Download
            </a>
          </Button>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          One click produces a dated, control-by-control record of this organization&apos;s
          compliance posture — every framework it maps to, and the evidence behind each control —
          generated fresh from what is running right now. Hand it to a regulator or an auditor as
          it is.
        </CardContent>
      </Card>
      <ExportersSurface embedded />
    </div>
  );
}
