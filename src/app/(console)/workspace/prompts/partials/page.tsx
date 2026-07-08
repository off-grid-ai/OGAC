import { PromptPartials } from '@/components/prompts/PromptPartials';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Prompt PARTIALS — a management surface for reusable prompt fragments composed into prompts via
// `{{>partial-name}}`. Full CRUD; URL-driven edit panel. Sibling of the prompt library.
export default async function PromptPartialsPage() {
  await requireModuleForUser('prompts');
  return <PromptPartials />;
}
