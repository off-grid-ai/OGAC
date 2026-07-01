import {
  BookOpen,
  CheckCircle as CircleCheck,
  ProhibitInset as CircleSlash,
  Plug,
} from '@phosphor-icons/react/dist/ssr';
import { GatewayControl } from '@/components/gateway/GatewayControl';
import { GatewayLogs } from '@/components/gateway/GatewayLogs';
import { GatewayTraffic } from '@/components/gateway/GatewayTraffic';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

interface GatewayInfo {
  name: string;
  base_url: string;
  docs: string;
  mcp: string;
  modalities: Record<string, string>;
  image_models?: string[];
}

const GATEWAY_URL = process.env.OFFGRID_GATEWAY_URL ?? 'http://127.0.0.1:7878';

async function fetchGateway(): Promise<GatewayInfo | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
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
        note={`No gateway detected at ${GATEWAY_URL}. Start Off Grid Desktop's local model gateway, or set OFFGRID_GATEWAY_URL.`}
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
            <p className="mt-1 font-mono text-xs text-muted-foreground">{`${GATEWAY_URL}/v1`}</p>
          </div>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            <Plug className="size-3" />
            connected
          </Badge>
        </CardHeader>
        <CardContent className="flex gap-4 text-xs text-muted-foreground">
          <a href={info.docs} className="flex items-center gap-1.5 hover:text-primary">
            <BookOpen className="size-3.5" />
            API docs
          </a>
          <a href={info.mcp} className="flex items-center gap-1.5 hover:text-primary">
            MCP endpoint
          </a>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="control">Control</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Modalities</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 lg:grid-cols-3">
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

          {info.image_models?.length ? (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Image models</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {info.image_models.map((m) => (
                  <Badge key={m} variant="secondary" className="font-mono">
                    {m}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="traffic" className="space-y-6">
          <GatewayTraffic />
        </TabsContent>
        <TabsContent value="logs">
          <GatewayLogs />
        </TabsContent>
        <TabsContent value="control">
          <GatewayControl />
        </TabsContent>
      </Tabs>
    </div>
  );
}
