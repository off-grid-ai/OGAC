import { DownloadSimple as Download, FileText } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireModule } from '@/lib/modules';
import { REPORTS } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  requireModule('reports');

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Regulator-ready reports</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each report is generated live from the control plane — traceable end to end — and
            exported as Markdown you can hand to a regulator or DPO.
          </p>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.id} className="flex flex-col shadow-sm">
            <CardHeader className="space-y-0">
              <div className="flex items-center gap-2.5">
                <FileText className="size-5 text-primary" />
                <CardTitle className="text-sm">{r.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">{r.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {r.source}
                </span>
                <Button asChild size="sm">
                  <a href={`/api/v1/admin/reports/${r.id}/export`}>
                    <Download className="size-4" />
                    Generate
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
