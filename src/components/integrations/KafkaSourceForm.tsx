'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { KafkaRegistryAuthMode, KafkaSaslMode } from '@/lib/kafka-source-onboarding';
import type { KafkaSourceView } from '@/lib/adapters/kafka-source-onboarding';

const SELECT =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

interface FormState {
  name: string;
  description: string;
  bootstrapEndpoint: string;
  schemaRegistryEndpoint: string;
  topic: string;
  schemaSubject: string;
  schemaVersion: string;
  schemaId: string;
  schemaSha256: string;
  tenantField: string;
  tls: boolean;
  sasl: KafkaSaslMode;
  username: string;
  password: string;
  registryAuth: KafkaRegistryAuthMode;
  registryToken: string;
  registryUsername: string;
  registryPassword: string;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  bootstrapEndpoint: '',
  schemaRegistryEndpoint: '',
  topic: '',
  schemaSubject: '',
  schemaVersion: '',
  schemaId: '',
  schemaSha256: '',
  tenantField: 'orgId',
  tls: true,
  sasl: 'none',
  username: '',
  password: '',
  registryAuth: 'none',
  registryToken: '',
  registryUsername: '',
  registryPassword: '',
};

function fromSource(source: KafkaSourceView): FormState {
  return {
    name: source.name,
    description: source.description,
    bootstrapEndpoint: source.bootstrapEndpoint,
    schemaRegistryEndpoint: source.schemaRegistryEndpoint,
    topic: source.topic,
    schemaSubject: source.schemaSubject,
    schemaVersion: String(source.schemaVersion),
    schemaId: String(source.schemaId),
    schemaSha256: source.schemaSha256,
    tenantField: source.tenantField,
    tls: source.security.tls,
    sasl: source.security.sasl,
    username: '',
    password: '',
    registryAuth: source.security.registryAuth,
    registryToken: '',
    registryUsername: '',
    registryPassword: '',
  };
}

function FieldError({ message }: Readonly<{ message?: string }>) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

export function KafkaSourceForm({
  open,
  source,
  onClose,
  onSaved,
}: Readonly<{
  open: boolean;
  source?: KafkaSourceView;
  onClose: () => void;
  onSaved: (source: KafkaSourceView) => void;
}>) {
  const [form, setForm] = useState<FormState>(source ? fromSource(source) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editing = Boolean(source);

  useEffect(() => {
    if (!open) return;
    setForm(source ? fromSource(source) : EMPTY);
    setErrors({});
  }, [open, source]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setErrors({});
    const url = editing
      ? `/api/v1/admin/kafka-sources/${encodeURIComponent(source!.connectorId)}`
      : '/api/v1/admin/kafka-sources';
    try {
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = (await response.json().catch(() => null)) as
        (KafkaSourceView & { error?: string; fields?: Record<string, string> }) | null;
      if (!response.ok || !body) {
        setErrors(body?.fields ?? {});
        toast.error(body?.error ?? 'The source could not be saved.');
        return;
      }
      toast.success(editing ? 'Kafka source updated' : 'Kafka source connected');
      onSaved(body);
    } catch {
      toast.error('The source did not respond. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = editing ? 'Save source' : 'Connect source';
  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={editing ? 'Edit Kafka source' : 'Connect Kafka or Redpanda'}
      description="Give governed apps one approved stream and exact schema. Credentials stay in the secret store."
      size="lg"
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          {busy ? 'Saving...' : submitLabel}
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3" aria-labelledby="kafka-source-details">
          <div>
            <h3 id="kafka-source-details" className="text-sm font-medium text-foreground">
              Source
            </h3>
            <p className="text-xs text-muted-foreground">
              Name the stream by the business signal it carries.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-source-name">Name</Label>
              <Input
                id="kafka-source-name"
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="Enterprise risk signals"
                aria-invalid={Boolean(errors.name)}
              />
              <FieldError message={errors.name} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-source-description">When should apps use it?</Label>
              <Textarea
                id="kafka-source-description"
                rows={2}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="Approved risk and operations events for customer servicing apps."
              />
              <FieldError message={errors.description} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kafka-bootstrap">Bootstrap endpoint</Label>
              <Input
                id="kafka-bootstrap"
                value={form.bootstrapEndpoint}
                onChange={(event) => set('bootstrapEndpoint', event.target.value)}
                placeholder="events.internal:9093"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <FieldError message={errors.bootstrapEndpoint} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kafka-topic">Topic</Label>
              <Input
                id="kafka-topic"
                value={form.topic}
                onChange={(event) => set('topic', event.target.value)}
                placeholder="enterprise.risk-signals"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <FieldError message={errors.topic} />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-5" aria-labelledby="kafka-schema">
          <div>
            <h3 id="kafka-schema" className="text-sm font-medium text-foreground">
              Approved schema
            </h3>
            <p className="text-xs text-muted-foreground">
              Records are refused when this exact schema or organization field does not match.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-schema-registry">Schema Registry endpoint</Label>
              <Input
                id="kafka-schema-registry"
                value={form.schemaRegistryEndpoint}
                onChange={(event) => set('schemaRegistryEndpoint', event.target.value)}
                placeholder="https://schemas.internal:8081"
                autoCapitalize="none"
                autoCorrect="off"
              />
              <FieldError message={errors.schemaRegistryEndpoint} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-schema-subject">Schema subject</Label>
              <Input
                id="kafka-schema-subject"
                value={form.schemaSubject}
                onChange={(event) => set('schemaSubject', event.target.value)}
                placeholder="enterprise.risk-signals-value"
              />
              <FieldError message={errors.schemaSubject} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kafka-schema-version">Version</Label>
              <Input
                id="kafka-schema-version"
                inputMode="numeric"
                value={form.schemaVersion}
                onChange={(event) => set('schemaVersion', event.target.value)}
                placeholder="1"
              />
              <FieldError message={errors.schemaVersion} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kafka-schema-id">Schema ID</Label>
              <Input
                id="kafka-schema-id"
                inputMode="numeric"
                value={form.schemaId}
                onChange={(event) => set('schemaId', event.target.value)}
                placeholder="29"
              />
              <FieldError message={errors.schemaId} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-schema-sha">Schema SHA-256</Label>
              <Input
                id="kafka-schema-sha"
                value={form.schemaSha256}
                onChange={(event) => set('schemaSha256', event.target.value)}
                placeholder="64-character approved schema hash"
                className="font-mono"
              />
              <FieldError message={errors.schemaSha256} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="kafka-tenant-field">Organization field</Label>
              <Input
                id="kafka-tenant-field"
                value={form.tenantField}
                onChange={(event) => set('tenantField', event.target.value)}
                placeholder="orgId"
              />
              <p className="text-xs text-muted-foreground">
                Each accepted record must carry the current organization ID in this field.
              </p>
              <FieldError message={errors.tenantField} />
            </div>
          </div>
        </section>

        <section className="space-y-3 border-t border-border pt-5" aria-labelledby="kafka-security">
          <div>
            <h3 id="kafka-security" className="text-sm font-medium text-foreground">
              Connection security
            </h3>
            <p className="text-xs text-muted-foreground">
              Leave credential fields blank while editing to keep the values already stored.
            </p>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
            <div>
              <Label htmlFor="kafka-tls">TLS</Label>
              <p className="text-xs text-muted-foreground">Encrypt the broker connection.</p>
            </div>
            <Switch
              id="kafka-tls"
              checked={form.tls}
              onCheckedChange={(value) => set('tls', value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kafka-sasl">Broker login</Label>
            <select
              id="kafka-sasl"
              value={form.sasl}
              onChange={(event) => set('sasl', event.target.value as KafkaSaslMode)}
              className={SELECT}
            >
              <option value="none">No login</option>
              <option value="plain">Username and password</option>
              <option value="scram-sha-256">SCRAM SHA-256</option>
              <option value="scram-sha-512">SCRAM SHA-512</option>
            </select>
            <FieldError message={errors.sasl} />
          </div>
          {form.sasl !== 'none' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="kafka-username">Username</Label>
                <Input
                  id="kafka-username"
                  value={form.username}
                  onChange={(event) => set('username', event.target.value)}
                  autoComplete="off"
                  placeholder={editing ? 'Keep stored username' : ''}
                />
                <FieldError message={errors.username} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kafka-password">Password</Label>
                <Input
                  id="kafka-password"
                  type="password"
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                  autoComplete="new-password"
                  placeholder={editing ? 'Keep stored password' : ''}
                />
                <FieldError message={errors.password} />
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="kafka-registry-auth">Schema Registry login</Label>
            <select
              id="kafka-registry-auth"
              value={form.registryAuth}
              onChange={(event) => set('registryAuth', event.target.value as KafkaRegistryAuthMode)}
              className={SELECT}
            >
              <option value="none">No login</option>
              <option value="bearer">Access token</option>
              <option value="basic">Username and password</option>
            </select>
            <FieldError message={errors.registryAuth} />
          </div>
          {form.registryAuth === 'bearer' ? (
            <div className="space-y-1.5">
              <Label htmlFor="kafka-registry-token">Access token</Label>
              <Input
                id="kafka-registry-token"
                type="password"
                value={form.registryToken}
                onChange={(event) => set('registryToken', event.target.value)}
                autoComplete="new-password"
                placeholder={editing ? 'Keep stored token' : ''}
              />
              <FieldError message={errors.registryToken} />
            </div>
          ) : null}
          {form.registryAuth === 'basic' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="kafka-registry-username">Registry username</Label>
                <Input
                  id="kafka-registry-username"
                  value={form.registryUsername}
                  onChange={(event) => set('registryUsername', event.target.value)}
                  autoComplete="off"
                  placeholder={editing ? 'Keep stored username' : ''}
                />
                <FieldError message={errors.registryUsername} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kafka-registry-password">Registry password</Label>
                <Input
                  id="kafka-registry-password"
                  type="password"
                  value={form.registryPassword}
                  onChange={(event) => set('registryPassword', event.target.value)}
                  autoComplete="new-password"
                  placeholder={editing ? 'Keep stored password' : ''}
                />
                <FieldError message={errors.registryPassword} />
              </div>
            </div>
          ) : null}
          <FieldError message={errors.request} />
        </section>
      </div>
    </FormSheet>
  );
}
