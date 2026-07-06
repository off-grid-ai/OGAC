import { GlobeHemisphereWest, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { McpInstallButton } from '@/components/tool-catalog/McpInstallButton';
import {
  mcpCatalogByCategory,
  internetReachingServers,
  MCP_SERVERS,
} from '@/lib/mcp-catalog';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { listTools } from '@/lib/store';

// ─── Tool catalog (Builder Epic #119) — browse + one-click add curated MCP servers ────────────────
// A curated catalog of well-known open-source MCP (Model Context Protocol) servers. The operator
// browses by category and "adds" one — which writes a registered `mcp` tool via the EXISTING
// tool-create path (POST /api/v1/admin/tools). The added tool then shows up in the builder's
// ToolPicker "Registered tools" group automatically (already wired by #117). We do NOT duplicate
// tool storage: the catalog is static curated metadata + an install action. Actual tool management
// (edit/disable/delete) stays on the Integrations tools surface.
export const dynamic = 'force-dynamic';

export default async function ToolCatalogPage() {
  await requireModuleForUser('tool-catalog');
  const org = await currentOrgId();
  const tools = await listTools(org);

  const groups = mcpCatalogByCategory();
  const internetCount = internetReachingServers().length;

  // Which catalog entries the operator has ALREADY added (matched by the prefilled name). Read-only
  // hint so the card can show "Added" instead of the install button — real management is on the
  // Integrations tools list.
  const addedNames = new Set(tools.filter((t) => t.type === 'mcp').map((t) => t.name));
  const isAdded = (serverName: string) => addedNames.has(`MCP: ${serverName}`);

  return (
    <div className="w-full space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">Tool catalog</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One-click add tools from the open-source MCP (Model Context Protocol) ecosystem. Adding a
          server registers it as an <span className="font-medium">MCP tool</span> your apps can use —
          it appears in the builder&apos;s tool picker under “Registered tools” right away. Manage,
          disable, or remove added tools on the{' '}
          <a href="/integrations" className="text-primary underline-offset-4 hover:underline">
            Integrations
          </a>{' '}
          page.
        </p>
      </header>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <GlobeHemisphereWest className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium">Air-gap: MCP servers run on your network — the console never reaches out.</p>
            <p className="text-muted-foreground">
              {internetCount} of {MCP_SERVERS.length} servers in this catalog reach the public
              internet when they run (marked{' '}
              <Badge variant="outline" className="mx-0.5 border-amber-500/40 text-amber-700">
                <GlobeHemisphereWest className="size-3" /> reaches internet
              </Badge>
              ). On an air-gapped deploy those need you to run or point them at a host you allow;
              nothing auto-connects. You always supply your own on-prem endpoint when adding a
              server — the catalog only gives a sample + the install command.
            </p>
          </div>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <section key={group.category} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.category}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.servers.map((server) => (
              <Card key={server.id} className="flex flex-col">
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{server.name}</CardTitle>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
                      {server.transport}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {server.reachesInternet ? (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                        <GlobeHemisphereWest className="size-3" /> reaches internet
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                        <ShieldCheck className="size-3" /> stays on-prem
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{server.description}</p>
                  <p className="text-xs text-muted-foreground/80">{server.airgapNote}</p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <a
                      href={server.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Docs
                    </a>
                    {isAdded(server.name) ? (
                      <Badge variant="secondary">Added</Badge>
                    ) : (
                      <McpInstallButton server={server} />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
