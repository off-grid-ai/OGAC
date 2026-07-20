import { ProjectsBrowser } from '@/components/projects/ProjectsBrowser';
import { PageFrame } from '@/components/PageFrame';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Projects as a top-level surface (ChatGPT/Claude parity) — a browsable library of project
// workspaces, each with its own instructions, knowledgebase, and chats. Reuses the existing
// /api/v1/chat/projects APIs; the detail lives at /projects/[id].
export default async function ProjectsPage() {
  await requireModuleForUser('projects');
  return (
    <PageFrame>
      <ProjectsBrowser />
    </PageFrame>
  );
}
