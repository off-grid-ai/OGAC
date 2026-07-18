import { KnowledgeContent } from '@/app/(console)/workspace/knowledge/page';

export default function KnowledgeCollectionsPage() {
  return <KnowledgeContent detailBasePath="/data/knowledge" embedded showHeading={false} />;
}
