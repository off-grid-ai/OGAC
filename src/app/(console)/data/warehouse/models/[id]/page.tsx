import Link from 'next/link';
import { WarehouseModelDetail } from '@/components/warehouse/WarehouseModelDetail';

export const dynamic = 'force-dynamic';

// Analytical-model detail — the deep-linkable place for one model: its version history, the live
// definition, and the apply-edit / rollback / delete actions (all applied live to ClickHouse).
export default async function WarehouseModelDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return (
    <div className="w-full space-y-4">
      <Link href="/data/warehouse/models" className="text-xs text-muted-foreground hover:underline">
        ← Analytical models
      </Link>
      <WarehouseModelDetail id={id} />
    </div>
  );
}
