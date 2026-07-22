import { ArrowLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { findPluginGroup, type PluginSchema, type PluginType } from '@/lib/kestra-catalog';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

const CATALOG_BASE = '/data/flows/orchestration/catalog';

// Plugin (group) detail — the actions/triggers/conditions this plugin adds. Selecting one sets
// ?type=<cls> and its input schema (properties, which are required, and outputs) renders in the
// side column, server-fetched and deep-linkable. Two-column full-width layout.
export default async function PluginGroupPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ group: string }>;
  searchParams: Promise<{ type?: string }>;
}>) {
  await requireModuleForUser('data');
  const { group: rawGroup } = await params;
  const group = decodeURIComponent(rawGroup);
  const { type } = await searchParams;

  const groups = await kestraCatalog.listPlugins();
  const plugin = findPluginGroup(groups, group);
  if (!plugin) notFound();

  const schema = type ? await kestraCatalog.getPluginSchema(type) : null;
  const groupHref = `${CATALOG_BASE}/${encodeURIComponent(group)}`;

  return (
    <PageFrame embedded>
      <div className="w-full space-y-6">
        <div className="space-y-3">
          <Link
            href={CATALOG_BASE}
            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Action catalog
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-mono text-lg font-semibold">{plugin.title}</h1>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{plugin.group}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{plugin.taskCount} actions</Badge>
              <Badge variant="outline">{plugin.triggerCount} triggers</Badge>
              <Badge variant="outline">{plugin.conditionCount} conditions</Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-6">
            <TypeSection title="Actions" types={plugin.tasks} groupHref={groupHref} selected={type} />
            <TypeSection title="Triggers" types={plugin.triggers} groupHref={groupHref} selected={type} />
            <TypeSection
              title="Conditions"
              types={plugin.conditions}
              groupHref={groupHref}
              selected={type}
            />
          </div>

          <div className="lg:sticky lg:top-4 lg:self-start">
            {schema ? (
              <SchemaPanel schema={schema} />
            ) : type ? (
              <Card>
                <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
                  Schema for <span className="font-mono">{type}</span> is unavailable (the engine may
                  be unreachable).
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
                  Select an action, trigger or condition to inspect what it needs to run.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageFrame>
  );
}

function TypeSection({
  title,
  types,
  groupHref,
  selected,
}: Readonly<{ title: string; types: PluginType[]; groupHref: string; selected?: string }>) {
  if (types.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="font-normal">({types.length})</span>
      </h2>
      <ul className="divide-y divide-border/60 rounded-md border border-border">
        {types.map((t) => {
          const active = t.cls === selected;
          const short = t.cls.split('.').pop() ?? t.cls;
          return (
            <li key={t.cls}>
              <Link
                href={`${groupHref}?type=${encodeURIComponent(t.cls)}`}
                scroll={false}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${
                  active ? 'bg-primary/10' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-mono">
                    {short}
                    {t.deprecated && <Badge variant="outline">deprecated</Badge>}
                  </span>
                  {t.title && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {t.title}
                    </span>
                  )}
                </span>
                <CaretRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SchemaPanel({ schema }: Readonly<{ schema: PluginSchema }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-all font-mono text-sm">{schema.type}</CardTitle>
        {schema.description && (
          <p className="text-sm text-muted-foreground">{schema.description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <PropTable heading={`Inputs (${schema.properties.length})`} props={schema.properties} showRequired />
        <PropTable heading={`Outputs (${schema.outputs.length})`} props={schema.outputs} />
      </CardContent>
    </Card>
  );
}

function PropTable({
  heading,
  props,
  showRequired = false,
}: Readonly<{
  heading: string;
  props: PluginSchema['properties'];
  showRequired?: boolean;
}>) {
  return (
    <div className="space-y-2">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      {props.length === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2">Type</th>
                {showRequired && <th className="px-3 py-2">Required</th>}
              </tr>
            </thead>
            <tbody>
              {props.map((p) => (
                <tr key={p.name} className="border-b border-border/60 align-top last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-mono">{p.name}</span>
                    {p.title && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">{p.title}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.type}</td>
                  {showRequired && (
                    <td className="px-3 py-2">
                      {p.required ? (
                        <Badge variant="secondary">required</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">optional</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
