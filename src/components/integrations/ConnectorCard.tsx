import { ConnectorRowActions } from '@/components/integrations/ConnectorRowActions';
import { Badge } from '@/components/ui/badge';

// Presentational card for one connector in the directory grid. The row-level "…" actions
// (sync / edit / delete) are unchanged — the same URL-driven ConnectorRowActions used by the
// old table, just relocated into a card header. No client state lives here.

const CON_STATUS: Record<string, string> = {
  connected: 'bg-primary/10 text-primary',
  error: 'bg-destructive/10 text-destructive',
};

export interface ConnectorCardData {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSync: string;
  endpoint: string;
  auth: string;
  description: string;
  custom: boolean;
}

export function ConnectorCard({ connector }: Readonly<{ connector: ConnectorCardData }>) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-300 ease-out hover:shadow-md">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="truncate text-sm font-medium text-foreground" title={connector.name}>
              {connector.name}
            </div>
            {connector.description ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">{connector.description}</p>
            ) : null}
          </div>
          <div className="-mr-1.5 -mt-1.5 shrink-0">
            <ConnectorRowActions
              connector={{
                id: connector.id,
                name: connector.name,
                type: connector.type,
                endpoint: connector.endpoint,
                auth: connector.auth,
                description: connector.description,
                custom: connector.custom,
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className={CON_STATUS[connector.status] ?? ''}>
            {connector.status}
          </Badge>
          <Badge variant="outline" className="capitalize">
            {connector.type}
          </Badge>
          <Badge variant="secondary" className="text-muted-foreground">
            {connector.auth}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Last sync
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{connector.lastSync}</span>
      </div>
    </div>
  );
}
