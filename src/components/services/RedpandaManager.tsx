'use client';

import {
  ArrowClockwise,
  CheckCircle,
  Flask,
  PaperPlaneTilt,
  Plus,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { RedpandaBoundary, RedpandaTopic } from '@/lib/redpanda-model';

interface Overview {
  boundaries: RedpandaBoundary[];
  brokers: unknown[];
  topics: RedpandaTopic[];
  subjects: string[];
}

type ManageTab = 'topics' | 'schemas' | 'workflows';

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
    requestedTab === 'schemas' || requestedTab === 'workflows' ? requestedTab : 'topics';
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('{}');
  const [subject, setSubject] = useState('');
  const [schema, setSchema] = useState('{}');
  const [schemaType, setSchemaType] = useState<'AVRO' | 'JSON' | 'PROTOBUF'>('JSON');
  const [schemaDetail, setSchemaDetail] = useState<{
    subject: string;
    versions: number[];
    details: unknown[];
  } | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [newTopic, setNewTopic] = useState('');
  const [newPartitions, setNewPartitions] = useState('1');
  const [newRetentionDays, setNewRetentionDays] = useState('7');
  const [editPartitions, setEditPartitions] = useState('');
  const [editRetentionDays, setEditRetentionDays] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState(false);

  const selectedTopicName = searchParams.get('topic');
  const selectedTopic = overview?.topics.find((item) => item.name === selectedTopicName) ?? null;
  const createTopicOpen = searchParams.get('panel') === 'create-topic';
  const selectedSubject = searchParams.get('subject');

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

  useEffect(() => {
    if (!selectedSubject) {
      setSchemaDetail(null);
      return;
    }
    void request(
      `/api/v1/admin/integrations/redpanda/schemas/${encodeURIComponent(selectedSubject)}`,
    )
      .then((detail) => setSchemaDetail(detail as typeof schemaDetail))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : 'Schema versions failed to load'),
      );
  }, [selectedSubject]);

  function setParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    });
    router.push(`?${params.toString()}`, { scroll: false });
  }

  function selectTab(next: ManageTab) {
    setParams({ manage: next, topic: null, panel: null });
  }

  async function produceJsonRecord() {
    try {
      const parsed = message.trim() ? JSON.parse(message) : null;
      const response = await request('/api/v1/admin/integrations/redpanda', {
        method: 'POST',
        body: JSON.stringify({ action: 'produce', topic, value: parsed }),
      });
      setResult(response);
      toast.success('Record produced');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed');
    }
  }

  async function createVersion() {
    try {
      await request('/api/v1/admin/integrations/redpanda/schemas', {
        method: 'POST',
        body: JSON.stringify({ subject, schema, schemaType }),
      });
      toast.success('Schema version registered');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Schema registration failed');
    }
  }

  async function deleteSubject(name: string) {
    const confirmation = window.prompt(
      `Delete every version of schema subject “${name}”? Type the exact subject name to confirm.`,
    );
    if (confirmation !== name) return;
    try {
      await request(`/api/v1/admin/integrations/redpanda/schemas/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmation }),
      });
      toast.success('Schema subject deleted');
      setParams({ subject: null });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Schema delete failed');
    }
  }

  async function deleteVersion(name: string, version: number) {
    if (!window.confirm(`Delete schema “${name}” version ${version}?`)) return;
    try {
      await request(
        `/api/v1/admin/integrations/redpanda/schemas/${encodeURIComponent(name)}/${version}`,
        { method: 'DELETE' },
      );
      toast.success('Schema version deleted');
      const detail = await request(
        `/api/v1/admin/integrations/redpanda/schemas/${encodeURIComponent(name)}`,
      );
      setSchemaDetail(detail as typeof schemaDetail);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Schema version delete failed');
    }
  }

  async function createKafkaTopic() {
    try {
      await request('/api/v1/admin/integrations/redpanda/topics', {
        method: 'POST',
        body: JSON.stringify({
          name: newTopic,
          partitions: Number(newPartitions),
          retentionMs: Number(newRetentionDays) * 86_400_000,
        }),
      });
      toast.success('Topic created');
      setParams({ panel: null, topic: newTopic });
      setNewTopic('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Topic create failed');
    }
  }

  async function updateKafkaTopic() {
    if (!selectedTopic) return;
    try {
      const update: Record<string, number> = {};
      if (editPartitions) update.partitions = Number(editPartitions);
      if (editRetentionDays) update.retentionMs = Number(editRetentionDays) * 86_400_000;
      await request(
        `/api/v1/admin/integrations/redpanda/topics/${encodeURIComponent(selectedTopic.name)}`,
        { method: 'PATCH', body: JSON.stringify(update) },
      );
      toast.success('Topic configuration updated');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Topic update failed');
    }
  }

  async function deleteKafkaTopic() {
    if (!selectedTopic) return;
    const confirmation = window.prompt(
      `Delete topic “${selectedTopic.name}” and every retained event? Type the exact topic name to confirm.`,
    );
    if (confirmation !== selectedTopic.name) return;
    try {
      await request(
        `/api/v1/admin/integrations/redpanda/topics/${encodeURIComponent(selectedTopic.name)}`,
        { method: 'DELETE', body: JSON.stringify({ confirmation }) },
      );
      toast.success('Topic deleted');
      setParams({ topic: null });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Topic delete failed');
    }
  }

  async function runWorkflow(journey: 'lender-delinquency' | 'insurance-claim') {
    setWorkflowBusy(true);
    try {
      const proof = await request('/api/v1/admin/integrations/redpanda/workflows', {
        method: 'POST',
        body: JSON.stringify({ journey }),
      });
      setResult(proof);
      toast.success('Event contract and round-trip verified');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workflow verification failed');
    } finally {
      setWorkflowBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-sm">Redpanda operations</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Admin, Schema Registry, native Kafka, and optional HTTP Proxy boundaries report their
            actual runtime state. Manual produce and workflow proof require native Kafka to be
            ready.
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

        <Tabs value={tab} onValueChange={(value) => selectTab(value as ManageTab)}>
          <TabsList>
            <TabsTrigger value="topics">Topics</TabsTrigger>
            <TabsTrigger value="schemas">Schemas</TabsTrigger>
            <TabsTrigger value="workflows">Workflow proof</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'topics' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.8fr)]">
            <Card className="shadow-none">
              <CardHeader className="flex-row items-center justify-between gap-4">
                <CardTitle className="text-sm">Topic inventory</CardTitle>
                <Button size="sm" onClick={() => setParams({ panel: 'create-topic' })}>
                  <Plus /> Create topic
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {(overview?.topics ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No topics reported by the Admin API.
                  </p>
                ) : (
                  overview?.topics.map((item) => (
                    <button
                      type="button"
                      key={`${item.namespace}/${item.name}`}
                      onClick={() => {
                        setEditPartitions(String(item.partitions));
                        setParams({ topic: item.name });
                      }}
                      className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono">
                        {item.namespace}/{item.name}
                      </span>
                      <span className="text-muted-foreground">
                        {item.partitions} partitions · {item.replicas.length} brokers
                      </span>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">
                  {selectedTopic ? selectedTopic.name : 'Select a topic'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedTopic ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="topic-partitions">Partitions</Label>
                        <Input
                          id="topic-partitions"
                          inputMode="numeric"
                          value={editPartitions}
                          onChange={(event) => setEditPartitions(event.target.value)}
                          placeholder={String(selectedTopic.partitions)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="topic-retention">Retention days</Label>
                        <Input
                          id="topic-retention"
                          inputMode="numeric"
                          value={editRetentionDays}
                          onChange={(event) => setEditRetentionDays(event.target.value)}
                          placeholder="Leave unchanged"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Button size="sm" variant="outline" onClick={() => void updateKafkaTopic()}>
                        Update configuration
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void deleteKafkaTopic()}>
                        <Trash /> Delete
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Select a topic to manage partitions and retention, or create a governed topic.
                  </p>
                )}
                <div className="space-y-2 border-t border-border pt-4">
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
                  <Button size="sm" onClick={() => void produceJsonRecord()}>
                    <PaperPlaneTilt /> Produce
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'schemas' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(24rem,1.2fr)]">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Schema subjects</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(overview?.subjects ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No schema subjects reported.</p>
                ) : (
                  overview?.subjects.map((name) => (
                    <div
                      key={name}
                      className="flex w-full items-center justify-between rounded-md border border-border px-3 py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setParams({ subject: name })}
                        className="min-w-0 flex-1 truncate py-2 text-left font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {name}
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => void deleteSubject(name)}>
                        <Trash /> Delete
                      </Button>
                    </div>
                  ))
                )}
                {schemaDetail ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs font-medium">{schemaDetail.subject} versions</p>
                    {schemaDetail.versions.map((version) => (
                      <div
                        key={version}
                        className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs"
                      >
                        <span>Version {version}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void deleteVersion(schemaDetail.subject, version)}
                        >
                          <Trash /> Delete version
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Create or update schema</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Registering the same subject creates its next version under the active
                  compatibility policy.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="subject"
                />
                <div className="flex flex-wrap gap-2" aria-label="Schema format">
                  {(['JSON', 'AVRO', 'PROTOBUF'] as const).map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      variant={schemaType === type ? 'default' : 'outline'}
                      onClick={() => setSchemaType(type)}
                    >
                      {type}
                    </Button>
                  ))}
                </div>
                <Textarea
                  value={schema}
                  onChange={(event) => setSchema(event.target.value)}
                  className="min-h-24 font-mono text-xs"
                />
                <Button size="sm" onClick={() => void createVersion()}>
                  Register version
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'workflows' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Prove a business event end to end</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Registers the JSON contract, publishes a correlated event through native Kafka,
                  consumes that exact event, and returns offsets as auditable evidence.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Button
                  disabled={workflowBusy}
                  onClick={() => void runWorkflow('lender-delinquency')}
                >
                  <Flask /> Prove delinquency flow
                </Button>
                <Button
                  disabled={workflowBusy}
                  variant="outline"
                  onClick={() => void runWorkflow('insurance-claim')}
                >
                  <Flask /> Prove claim flow
                </Button>
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader className="flex-row items-center gap-2">
                <CheckCircle className="size-4 text-primary" />
                <CardTitle className="text-sm">Latest proof</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px]">
                  {result === null
                    ? 'No workflow proof recorded in this session.'
                    : JSON.stringify(result, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>

      <FormSheet
        open={createTopicOpen}
        onOpenChange={(open) => setParams({ panel: open ? 'create-topic' : null })}
        title="Create Redpanda topic"
        description="Create a native Kafka topic with bounded partitions and retention."
        footer={
          <Button onClick={() => void createKafkaTopic()} disabled={!newTopic.trim()}>
            <Plus /> Create topic
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="new-topic-name">Topic name</Label>
            <Input
              id="new-topic-name"
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              placeholder="lender.collection-actions"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-topic-partitions">Partitions</Label>
            <Input
              id="new-topic-partitions"
              inputMode="numeric"
              value={newPartitions}
              onChange={(event) => setNewPartitions(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-topic-retention">Retention days</Label>
            <Input
              id="new-topic-retention"
              inputMode="numeric"
              value={newRetentionDays}
              onChange={(event) => setNewRetentionDays(event.target.value)}
            />
          </div>
        </div>
      </FormSheet>
    </Card>
  );
}
