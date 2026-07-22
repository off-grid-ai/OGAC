import { GlobeHemisphereWest, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DeleteRowButton } from '@/components/admin/DeleteRowButton';
import { ToolToggle } from '@/components/brain/ToolToggle';
import { McpInstallButton } from '@/components/tool-catalog/McpInstallButton';
import { CatalogControls } from '@/components/tools/CatalogControls';
import { EditToolButton } from '@/components/tools/EditToolButton';
import { RegisterToolButton } from '@/components/tools/RegisterToolButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MCP_CATEGORIES,
  MCP_SERVERS,
  internetReachingServers,
  mcpCatalogByCategory,
} from '@/lib/mcp-catalog';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { allowlistReferencesTokens, normalizeRefToken } from '@/lib/pipelines-policy';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { primitiveCatalog } from '@/lib/tool-primitives';
import { filterCatalog } from '@/lib/tools-view';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

// ─── Canonical Tools destinations — one source for every tool an app can call ────────────────────
// Unifies the three formerly-scattered tool surfaces under Solutions:
//   • Registered — the HTTP/MCP tool registry (full CRUD: register/edit/delete/toggle), formerly the
//     Brain "Tools & services" view. Writes go through the EXISTING /api/v1/admin/tools routes.
//   • Catalog    — the curated MCP catalog to one-click add from (search + category filter over the
//     18 servers), formerly the orphaned /tool-catalog page (now a redirect here).
//   • Primitives — the built-in web_search / read_url / http primitives + their air-gap enabled state
//     (read-only + how-to-enable), from tool-primitives.ts.
// Each destination owns a real child route. Query parameters only filter the active destination.
export const dynamic = 'force-dynamic';

const TOOL_TYPE: Record<string, string> = {
  http: 'bg-blue-500/10 text-blue-600',
  mcp: 'bg-primary/10 text-primary',
};

export default async function ToolsPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ destination: string }>;
  searchParams: Promise<{ q?: string; cat?: string }>;
}>) {
  await requireModuleForUser('tools');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(contextualModule('solutions-tools'), rawDestination);
  if (!destination) notFound();
  const { q = '', cat } = await searchParams;
  const org = await currentOrgId();
  // Degrade gracefully: DB down → empty tools list, page still renders (create/import still reachable).
  const tools = destination.id === 'primitives' ? [] : await listTools(org).catch(() => []);

  // Reverse edge: how many pipelines reference each tool (by id or name) in their data ceiling. One
  // pipelines read, then a pure per-tool token match — so each tool card can read "used by N pipelines".
  const pipelines = destination.id === 'registered' ? await listPipelines(org).catch(() => []) : [];
  const usedByCount: Record<string, number> = {};
  for (const t of tools) {
    const tokens = [normalizeRefToken(t.id), normalizeRefToken(t.name)].filter(Boolean);
    usedByCount[t.id] = pipelines.filter((p) =>
      allowlistReferencesTokens(p.dataAllowlist, tokens),
    ).length;
  }

  if (destination.id === 'registered') {
    return <RegisteredTab tools={tools} usedByCount={usedByCount} />;
  }
  if (destination.id === 'catalog') {
    return <CatalogTab tools={tools} query={q} category={cat ?? null} />;
  }
  return <PrimitivesTab />;
}

// ─── Registered — the HTTP/MCP tool registry, full CRUD ───────────────────────────────────────────
function RegisteredTab({
  tools,
  usedByCount,
}: Readonly<{
  tools: Awaited<ReturnType<typeof listTools>>;
  usedByCount: Record<string, number>;
}>) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Registered tools · {tools.length}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            The router&apos;s <code>tool</code> source — HTTP / MCP tools matched to query intent.
            Register, edit, enable, or remove them here; add from the{' '}
            <Link
              href="/solutions/tools/catalog"
              className="text-primary underline-offset-4 hover:underline"
            >
              Catalog
            </Link>
            .
          </p>
        </div>
        <RegisterToolButton />
      </CardHeader>
      <CardContent>
        {tools.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No tools registered yet. Register one above, or one-click add a server from the{' '}
              <Link
                href="/solutions/tools/catalog"
                className="text-primary underline-offset-4 hover:underline"
              >
                Catalog
              </Link>
              .
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>When to use</TableHead>
                <TableHead className="w-28">Used by</TableHead>
                <TableHead className="w-16">Enabled</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-foreground">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={TOOL_TYPE[t.type]}>
                      {t.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-sm truncate text-muted-foreground">
                    {t.description || t.endpoint}
                  </TableCell>
                  <TableCell>
                    {usedByCount[t.id] ? (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        {usedByCount[t.id]} pipeline{usedByCount[t.id] === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ToolToggle id={t.id} enabled={t.enabled} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <EditToolButton
                        id={t.id}
                        name={t.name}
                        endpoint={t.endpoint}
                        description={t.description}
                      />
                      <DeleteRowButton url={`/api/v1/admin/tools/${t.id}`} label={t.name} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Catalog — curated MCP servers, one-click add → registered mcp tool ───────────────────────────
function CatalogTab({
  tools,
  query,
  category,
}: Readonly<{
  tools: Awaited<ReturnType<typeof listTools>>;
  query: string;
  category: string | null;
}>) {
  const filtered = filterCatalog(MCP_SERVERS, query, category);
  const groups = mcpCatalogByCategory(filtered);
  const internetCount = internetReachingServers().length;

  // Which catalog entries the operator has ALREADY added (matched by the prefilled name).
  const addedNames = new Set(tools.filter((t) => t.type === 'mcp').map((t) => t.name));
  const isAdded = (serverName: string) => addedNames.has(`MCP: ${serverName}`);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        One-click add tools from the open-source MCP (Model Context Protocol) ecosystem. Adding a
        server registers it as an <span className="font-medium">MCP tool</span> — it appears under{' '}
        <Link
          href="/solutions/tools/registered"
          className="text-primary underline-offset-4 hover:underline"
        >
          Registered
        </Link>{' '}
        and in the builder&apos;s tool picker right away.
      </p>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <GlobeHemisphereWest className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="font-medium">
              Air-gap: MCP servers run on your network — the console never reaches out.
            </p>
            <p className="text-muted-foreground">
              {internetCount} of {MCP_SERVERS.length} servers in this catalog reach the public
              internet when they run (marked{' '}
              <Badge variant="outline" className="mx-0.5 border-amber-500/40 text-amber-700">
                <GlobeHemisphereWest className="size-3" /> reaches internet
              </Badge>
              ). You always supply your own on-prem endpoint when adding a server — nothing
              auto-connects.
            </p>
          </div>
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        <CatalogControls categories={MCP_CATEGORIES} />
      </Suspense>

      {groups.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">No servers match your search.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.category}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.servers.map((server) => (
                <Card key={server.id} className="flex flex-col">
                  <CardHeader className="space-y-2">
                    <CardTitle className="text-base leading-snug">{server.name}</CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5 [grid-column:1/-1]">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {server.transport}
                      </Badge>
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
        ))
      )}
    </div>
  );
}

// ─── Primitives — the built-in first-party tools + their air-gap enabled state (read-only) ────────
function PrimitivesTab() {
  const primitives = primitiveCatalog(process.env as Record<string, string | undefined>);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Built-in first-party tools an app&apos;s agent step can call directly. Each reaches the
        public internet, so on an air-gapped deployment they are{' '}
        <span className="font-medium">off by default</span> until the org opts in via an environment
        flag. These are managed by configuration, not here — the state below is read-only.
      </p>

      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="space-y-1">
            <p className="font-medium">How to enable a primitive</p>
            <p className="text-muted-foreground">
              Set the master flag <code>OFFGRID_TOOL_EGRESS=1</code> to allow every internet
              primitive, or a per-tool flag (<code>OFFGRID_TOOL_WEB_SEARCH</code>,{' '}
              <code>OFFGRID_TOOL_READ_URL</code>, <code>OFFGRID_TOOL_HTTP_FETCH</code>) in the
              deployment&apos;s environment (see{' '}
              <a
                href="/operations/configuration"
                className="text-primary underline-offset-4 hover:underline"
              >
                Configuration
              </a>
              ). Applied on restart.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {primitives.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2 [grid-column:1/-1]">
                <CardTitle className="text-base leading-snug">{p.name}</CardTitle>
                <Badge
                  variant="secondary"
                  className={
                    p.enabled
                      ? 'shrink-0 bg-emerald-500/10 text-emerald-600'
                      : 'shrink-0 bg-muted text-muted-foreground'
                  }
                >
                  {p.enabled ? 'enabled' : 'off (air-gap)'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 [grid-column:1/-1]">
                {p.reachesInternet ? (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                    <GlobeHemisphereWest className="size-3" /> reaches internet
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                    <ShieldCheck className="size-3" /> stays on-prem
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-[10px]">
                  {p.ref}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2">
              <p className="text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-auto text-xs text-muted-foreground/80">{p.airgapNote}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
