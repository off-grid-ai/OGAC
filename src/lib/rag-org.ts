// The org a project belongs to — needed by the subject index, which is org-scoped while the project
// RAG tables are not. A tiny reader rather than threading orgId through every addDocument caller.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { chatProjects } from '@/db/schema';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export async function orgIdForProject(projectId: string): Promise<string> {
  const [row] = await db
    .select({ orgId: chatProjects.orgId })
    .from(chatProjects)
    .where(eq(chatProjects.id, projectId))
    .limit(1);
  return row?.orgId ?? DEFAULT_ORG;
}
