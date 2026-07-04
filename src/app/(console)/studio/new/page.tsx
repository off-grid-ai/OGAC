import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StudioBuilder } from '@/components/studio/StudioBuilder';
import { requireModuleForUser } from '@/lib/module-access';
import { listTools } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Non-technical assistant builder (Phase 4.5). Loads the org's enabled tools as selectable skills;
// the builder wires the governed agent + template behind the scenes.
export default async function StudioNewPage() {
  await requireModuleForUser('studio');
  const tools = await listTools(await currentOrgId()).catch(() => []);
  const toolOptions = tools.filter((t) => t.enabled).map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Studio
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-foreground">New assistant</h1>
        <p className="text-sm text-muted-foreground">
          Describe it in plain language. Off Grid wires the model, policy, guardrails, and grounding
          for you — no technical setup.
        </p>
      </div>
      <StudioBuilder tools={toolOptions} />
    </div>
  );
}
