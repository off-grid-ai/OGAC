import { DataLakeManager } from '@/components/lake/DataLakeManager';

export const dynamic = 'force-dynamic';

// Data lake — governed object storage over SeaweedFS's S3 API: buckets + objects (upload/download/
// delete) + retention. Full-width management surface.
export default function DataLakePage() {
  return (
    <div className="w-full space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Data · Lake</p>
        <h1 className="text-lg font-semibold">Object store</h1>
        <p className="text-sm text-muted-foreground">
          Governed buckets + objects on the private S3 lake — documents, artifacts, and exports.
        </p>
      </div>
      <DataLakeManager />
    </div>
  );
}
