import { DataLakeManager } from '@/components/lake/DataLakeManager';
import { DurabilityPanel } from '@/components/lake/DurabilityPanel';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Data lake — governed object storage over SeaweedFS's S3 API: buckets + objects (upload/download/
// delete) + retention. Full-width management surface.
export default function DataLakePage() {
  return (
    <PageFrame>
      <div className="w-full space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Data · Lake</p>
          <h1 className="text-lg font-semibold">Object store</h1>
          <p className="text-sm text-muted-foreground">
            Governed buckets + objects on the private S3 lake — documents, artifacts, and exports.
          </p>
        </div>
        {/* Durability leads, because "is it up" was the only thing the console could say about this
            store and it is the least interesting thing about it. On this deployment there is one copy
            of every file, and an operator should read that before uploading anything. */}
        <DurabilityPanel />
        <DataLakeManager />
      </div>
    </PageFrame>
  );
}
