'use client';

import { PencilSimple, Trash } from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { KafkaSourceForm } from '@/components/integrations/KafkaSourceForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { KafkaSourceView } from '@/lib/adapters/kafka-source-onboarding';
import { panelHref, withPanelParams } from '@/lib/url-panel';

function Fact({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="mt-1 break-all text-sm text-foreground">{value}</div>
    </div>
  );
}

export function KafkaSourceSummary({
  source,
  onEdit,
  onDelete,
}: Readonly<{
  source: KafkaSourceView;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-sm">Governed event source</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Apps read only this topic, schema, and organization field. Credentials are never shown
            here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PencilSimple className="size-4" /> Edit or rotate
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash className="size-4" /> Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Topic" value={<code className="font-mono text-xs">{source.topic}</code>} />
        <Fact
          label="Bootstrap"
          value={<code className="font-mono text-xs">{source.bootstrapEndpoint}</code>}
        />
        <Fact
          label="Schema subject"
          value={<code className="font-mono text-xs">{source.schemaSubject}</code>}
        />
        <Fact label="Schema identity" value={`v${source.schemaVersion} / id ${source.schemaId}`} />
        <Fact
          label="Schema SHA-256"
          value={<code className="font-mono text-xs">{source.schemaSha256}</code>}
        />
        <Fact
          label="Organization field"
          value={<code className="font-mono text-xs">{source.tenantField}</code>}
        />
        <Fact
          label="Broker security"
          value={
            <span className="flex flex-wrap gap-1">
              <Badge variant="secondary">{source.security.tls ? 'TLS' : 'no TLS'}</Badge>
              <Badge variant="secondary">
                {source.security.sasl === 'none' ? 'no login' : source.security.sasl}
              </Badge>
            </span>
          }
        />
        <Fact
          label="Schema Registry login"
          value={
            source.security.registryAuth === 'none'
              ? 'none'
              : `${source.security.registryAuth} credential stored`
          }
        />
      </CardContent>
    </Card>
  );
}

export function KafkaSourceManager({ connectorId }: Readonly<{ connectorId: string }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [source, setSource] = useState<KafkaSourceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editOpen = params.get('panel') === 'edit-kafka-source';

  const setEditOpen = useCallback(
    (open: boolean) => {
      if (!open) {
        router.back();
        return;
      }
      const query = withPanelParams(params.toString(), {
        panel: 'edit-kafka-source',
      });
      router.push(panelHref(pathname, query), { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/admin/kafka-sources/${encodeURIComponent(connectorId)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      const body = (await response.json().catch(() => null)) as
        (KafkaSourceView & { error?: string }) | null;
      if (!response.ok || !body)
        throw new Error(body?.error ?? 'The source details are unavailable.');
      setSource(body);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The source took longer than 8 seconds to respond. Try again.'
          : cause instanceof Error
            ? cause.message
            : 'The source details are unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/v1/admin/kafka-sources/${encodeURIComponent(connectorId)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(8_000) },
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'The source could not be deleted.');
      toast.success('Kafka source deleted');
      router.push('/data');
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The source could not be deleted.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <Card aria-label="Loading governed Kafka source">
        <CardHeader>
          <Skeleton className="h-4 w-44" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error || !source) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm">Source details unavailable</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <KafkaSourceSummary
        source={source}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setConfirmDelete(true)}
      />

      <KafkaSourceForm
        open={editOpen}
        source={source}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => {
          setSource(next);
          const query = withPanelParams(params.toString(), { panel: null });
          router.replace(panelHref(pathname, query), { scroll: false });
          router.refresh();
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Kafka source?</DialogTitle>
            <DialogDescription>
              This removes the connector, approved topic binding, and stored credentials. Apps using
              this source will stop reading events.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete source'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
