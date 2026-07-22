import { WarehouseModelsManager } from '@/components/warehouse/WarehouseModelsManager';

export const dynamic = 'force-dynamic';

// Analytical models — governed views/tables over the warehouse, applied LIVE to ClickHouse. Full-width
// list → detail management surface (create here, drill into [id] for versions + rollback/delete).
export default function WarehouseModelsPage() {
  return (
    <div className="w-full space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Data · Warehouse</p>
        <h1 className="text-lg font-semibold">Analytical models</h1>
        <p className="text-sm text-muted-foreground">
          Governed views + tables materialized over the warehouse — versioned, with rollback.
        </p>
      </div>
      <WarehouseModelsManager />
    </div>
  );
}
