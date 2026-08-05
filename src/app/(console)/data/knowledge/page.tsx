import { KnowledgeContent } from '@/app/(console)/workspace/knowledge/content';

export default function KnowledgeCollectionsPage() {
  return <KnowledgeContent detailBasePath="/data/knowledge" embedded showHeading={false} />;
}
