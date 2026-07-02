import { PromptLibrary } from '@/components/prompts/PromptLibrary';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Prompt library as a top-level surface — a searchable/tag-filterable library of reusable prompts,
// plus a Common Prompts panel mined from the gateway's call history. Distinct from skills
// (assistants): this is plain reusable prompt text. Reuses /api/v1/prompts.
export default async function PromptsPage() {
  await requireModuleForUser('prompts');
  return <PromptLibrary />;
}
