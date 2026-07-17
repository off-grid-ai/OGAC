'use client';

import { ArrowClockwise, PaperPlaneTilt, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { RedpandaBoundary, RedpandaTopic } from '@/lib/redpanda-model';

interface Overview {
  boundaries: RedpandaBoundary[];
  brokers: unknown[];
  topics: RedpandaTopic[];
  subjects: string[];
}

type ManageTab = 'topics' | 'schemas' | 'consumer';

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}

export function RedpandaManager() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('manage');
  const tab: ManageTab =
    requestedTab === 'schemas' || requestedTab === 'consumer' ? requestedTab : 'topics';
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('{}');
  const [group, setGroup] = useState('offgrid-console');
  const [subject, setSubject] = useState('');
  const [schema, setSchema] = useState('{}');
  const [result, setResult] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOverview((await request('/api/v1/admin/integrations/redpanda')) as Overview);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Redpanda inspection failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  function selectTab(next: ManageTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('manage', next);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  async function runAction(action: 'produce' | 'consume') {
    try {
      const parsed = message.trim() ? JSON.parse(message) : null;
      const response = await request('/api/v1/admin/integrations/redpanda', {
        method: 'POST',
        body: JSON.stringify({ action, topic, group, value: parsed }),
      });
      setResult(response);
      toast.success(action === 'produce' ? 'Record produced' : 'Consumer poll completed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  }

  async function createVersion() {
    try {
      await request('/api/v1/admin/integrations/redpanda/schemas', {
        method: 'POST',
        body: JSON.stringify({ subject, schema, schemaType: 'JSON' }),
      });
      toast.success('Schema version registered');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Schema registration failed');
    }
  }

  async function deleteSubject(name: string) {
    if (!window.confirm(`Delete every version of schema subject “${name}”?`)) return;
    try {
      await request(`/api/v1/admin/integrations/redpanda/schemas/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      toast.success('Schema subject deleted');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Schema delete failed');
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-sm">Redpanda operations</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin inspection is always probed. Schema and produce/consume controls appear with their
            actual HTTP boundary state.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <ArrowClockwise className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          {(overview?.boundaries ?? []).map((boundary) => (
            <div key={boundary.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>{boundary.id}</span>
                <Badge variant="outline">{boundary.state}</Badge>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{boundary.detail}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-b border-border">
          {(['topics', 'schemas', 'consumer'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => selectTab(value)}
              className={`border-b-2 px-3 py-2 text-xs capitalize ${tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
            >
              {value}
            </button>
          ))}
        </div>

        {tab === 'topics' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(overview?.topics ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No topics reported by the Admin API.
                </p>
              ) : (
                overview?.topics.map((item) => (
                  <div
                    key={`${item.namespace}/${item.name}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <span className="font-mono">
                      {item.namespace}/{item.name}
                    </span>
                    <span className="text-muted-foreground">
                      {item.partitions} partitions · {item.replicas.length} brokers
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-medium">Produce a JSON record</p>
              <Input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="topic"
              />
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="min-h-24 font-mono text-xs"
              />
              <Button size="sm" onClick={() => void runAction('produce')}>
                <PaperPlaneTilt /> Produce
              </Button>
            </div>
          </div>
        )}

        {tab === 'schemas' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              {(overview?.subjects ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No schema subjects reported.</p>
              ) : (
                overview?.subjects.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs"
                  >
                    <span className="font-mono">{name}</span>
                    <Button variant="ghost" size="sm" onClick={() => void deleteSubject(name)}>
                      <Trash /> Delete
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-medium">Create or update schema</p>
              <p className="text-[11px] text-muted-foreground">
                Registering the same subject creates its next version.
              </p>
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="subject"
              />
              <Textarea
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
                className="min-h-24 font-mono text-xs"
              />
              <Button size="sm" onClick={() => void createVersion()}>
                Register version
              </Button>
            </div>
          </div>
        )}

        {tab === 'consumer' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-medium">Temporary consumer poll</p>
              <Input
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                placeholder="consumer group"
              />
              <Input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="topic"
              />
              <Button size="sm" onClick={() => void runAction('consume')}>
                Create, poll, and close consumer
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px]">
              {result === null ? 'No consumer result yet.' : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
