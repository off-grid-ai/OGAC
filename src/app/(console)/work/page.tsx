import { auth } from '@/auth';
import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { listArtifacts, listConversations, listProjects } from '@/lib/chat';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function WorkPage() {
  const session = await auth();
  const orgId = await currentOrgId();
  const userId = session?.user?.email ?? '';
  const [projects, conversations, artifacts] = userId
    ? await Promise.all([
        safeWithTimeout(() => listProjects(userId, orgId), 1200, null),
        safeWithTimeout(() => listConversations(userId, orgId), 1200, null),
        safeWithTimeout(() => listArtifacts(userId, orgId), 1200, null),
      ])
    : [null, null, null];

  const model = buildDomainDashboard('work', {
    facts: [
      {
        label: 'Projects',
        value: projects ? projects.length.toLocaleString() : 'Unavailable',
        description: projects ? 'Workspaces available to you.' : 'Project records did not respond.',
        href: '/work/projects',
        state: projects ? 'neutral' : 'attention',
      },
      {
        label: 'Conversations',
        value: conversations ? conversations.length.toLocaleString() : 'Unavailable',
        description: conversations
          ? 'Private conversations in this organization.'
          : 'Conversation records did not respond.',
        href: '/work/chat',
        state: conversations ? 'neutral' : 'attention',
      },
      {
        label: 'Artifacts',
        value: artifacts ? artifacts.length.toLocaleString() : 'Unavailable',
        description: artifacts
          ? 'Saved outputs ready to reopen.'
          : 'Artifact records did not respond.',
        href: '/work/artifacts',
        state: artifacts ? 'neutral' : 'attention',
      },
    ],
    activities: (projects ?? []).slice(0, 6).map((project) => ({
      id: project.id,
      label: project.name,
      detail: `${project.chatCount} conversation${project.chatCount === 1 ? '' : 's'}`,
      timestamp:
        project.updatedAt instanceof Date
          ? project.updatedAt.toISOString().slice(0, 10)
          : undefined,
      href: `/work/projects/${project.id}`,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model} />
    </PageFrame>
  );
}
