import { auth } from '@/auth';
import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
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

  // Counted from the same read the tasks page uses, so the number here and the list there cannot
  // disagree. Unavailable is reported as such rather than as zero — a failed read must never present
  // as "nothing needs you".
  const waitingRuns = await safeWithTimeout(
    () => listAppRunsView(undefined, orgId, 300),
    1500,
    null,
  );
  const waiting = waitingRuns
    ? waitingRuns.filter((r) => String(r.status) === 'awaiting_human').length
    : null;

  const model = buildDomainDashboard('work', {
    facts: [
      // WHAT NEEDS THEM, FIRST. This page led with counts of projects, conversations and artifacts —
      // platform objects. The one thing a department person comes here to find out is whether anything
      // is waiting on them, and it was only answerable by opening each app in turn.
      {
        label: 'Waiting on you',
        value: waiting == null ? 'Unavailable' : waiting.toLocaleString(),
        description:
          waiting == null
            ? 'Case records did not respond.'
            : waiting === 0
              ? 'Nothing needs a decision from a person right now.'
              : `${waiting === 1 ? 'A case is' : 'Cases are'} paused for someone to decide. Oldest first.`,
        href: '/work/tasks',
        state: waiting == null ? 'attention' : waiting > 0 ? 'attention' : 'good',
      },
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
    // Every row here is a PROJECT, and it must say so: the list rendered projects exactly like
    // conversations — title, grey subtitle, date — so "Reimbursement queries · 1 conversation" read as a
    // chat, while clicking it opens a project. Different destination, different thing, identical row.
    activities: (projects ?? []).slice(0, 6).map((project) => ({
      id: project.id,
      kind: 'Project',
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
