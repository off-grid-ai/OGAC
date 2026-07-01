import { ProjectDetail } from '@/components/projects/ProjectDetail';
import { requireModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

// Full-page project workspace: instructions editor, knowledge upload/list, and the project's
// chats with a link into /chat scoped to it. Reuses the existing project + document APIs.
export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  requireModule('projects');
  const { id } = await params;
  return <ProjectDetail projectId={id} />;
}
