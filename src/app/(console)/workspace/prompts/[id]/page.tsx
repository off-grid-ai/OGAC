import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { PromptDetail } from '@/components/prompts/PromptDetail';
import { requireModuleForUser } from '@/lib/module-access';
import { getPrompt } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

// Prompt DETAIL — the deep, deep-linkable view behind one library prompt (audit A-finding: prompts
// were edit-inline-only, no `/prompts/[id]`). Shows the full template, its {{variables}} with a
// fill-and-copy preview, tags/metadata/usage, and the prompt's actions (copy, edit, delete). Reached
// by clicking a prompt card on the library (URL-driven). Visibility mirrors the list: a user may view
// an org-visible prompt or their own private one.
export default async function PromptDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('prompts');
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email ?? '';

  const p = await getPrompt(id);
  if (!p || !(p.visibility === 'org' || p.owner === email)) notFound();

  const isOwner = p.owner === email;
  return (
    <PromptDetail
      prompt={{
        id: p.id,
        title: p.title,
        content: p.content,
        tags: p.tags ?? [],
        variables: p.variables ?? [],
        owner: p.owner,
        visibility: p.visibility,
        uses: p.uses,
        createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
        updatedAt: (p.updatedAt instanceof Date ? p.updatedAt : new Date(p.updatedAt)).toISOString(),
      }}
      isOwner={isOwner}
    />
  );
}
