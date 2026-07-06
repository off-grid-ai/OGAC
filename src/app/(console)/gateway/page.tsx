import {
  BookOpen,
  CheckCircle as CircleCheck,
  ProhibitInset as CircleSlash,
  Plug,
} from '@phosphor-icons/react/dist/ssr';
import { GatewayNodesCard } from '@/components/gateway/GatewayNodesCard';
import { GatewayTabs } from '@/components/gateway/GatewayTabs';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toDisplayHost } from '@/lib/display-host';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

interface GatewayNode {
  name: string;
  host: string;
  model: string;
  vision?: boolean;
  up?: boolean;
  health?: string;
}
interface GatewayInfo {
  name: string;
  base_url: string;
  docs: string;
  mcp: string;
  modalities: Record<string, string>;
  image_models?: (string | { id: string; gateways?: string[] })[];
  gateways?: GatewayNode[];
}

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

async function fetchGateway(): Promise<GatewayInfo | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.OFFGRID_GATEWAY_API_KEY ?? '' },
      // Generous: the aggregator's `/` fans out to probe every node, so it can take >1.5s
      // when some nodes are slow/down. Too-tight a timeout falsely shows "no gateway".
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as GatewayInfo;
  } catch {
    return null;
  }
}

export default async function GatewayPage() {
  await requireModuleForUser('gateway');
  const info = await fetchGateway();

  if (!info) {
    return (
      <ModulePlaceholder
        id="gateway"
        note={`No gateway detected at ${toDisplayHost(GATEWAY_URL)}. Start Off Grid Desktop's local model gateway, or set OFFGRID_GATEWAY_URL.`}
      />
    );
  }

  const modalities = Object.entries(info.modalities);

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-sm">{info.name}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{`${toDisplayHost(GATEWAY_URL)}/v1`}</p>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <Plug className="size-3" />
            connected
          </Badge>
        </CardHeader>
        <CardContent className="flex gap-4 text-xs text-muted-foreground">
          <a href={toDisplayHost(info.docs)} className="flex items-center gap-1.5 hover:text-primary">
            <BookOpen className="size-3.5" />
            API docs
          </a>
          <a href={toDisplayHost(info.mcp)} className="flex items-center gap-1.5 hover:text-primary">
            MCP endpoint
          </a>
        </CardContent>
      </Card>

      <GatewayTabs
        overview={
          <>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Modalities</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
              {modalities.map(([name, status]) => {
                const ready = status === 'ready';
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span className="text-sm text-foreground">{name.replace(/_/g, ' ')}</span>
                    {ready ? (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <CircleCheck className="size-3.5" />
                        ready
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CircleSlash className="size-3.5" />
                        {status}
                      </span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {info.gateways?.length ? <GatewayNodesCard initial={info.gateways} /> : null}

          {info.image_models?.length ? (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Image models</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {info.image_models.map((m) => {
                  // The aggregator may return image_models as strings OR {id, gateways} objects.
                  const id = typeof m === 'string' ? m : m.id;
                  return (
                    <Badge key={id} variant="secondary" className="font-mono">
                      {id}
                    </Badge>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
          </>
        }
      />
    </div>
  );
}
