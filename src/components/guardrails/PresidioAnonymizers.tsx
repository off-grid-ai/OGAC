'use client';

import { Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ImageRedactionPanel } from '@/components/guardrails/ImageRedactionPanel';
import {
  ANONYMIZE_OPERATORS,
  type AnonymizeOperator,
  type AnonymizerPolicy,
  describeOperator,
  HASH_TYPES,
  type HashType,
  type OperatorSpec,
  policyUsesEncrypt,
} from '@/lib/presidio-anonymizers';

// Per-entity anonymizer OPERATOR policy editor + a live test box. This is the "how do we mask each
// entity" surface: for every entity type, pick an operator (mask / redact / hash / encrypt /
// replace / keep) and its params. Saves the whole policy to /api/v1/admin/governance/masking/policy;
// the test box POSTs to .../masking/test and shows raw → masked so an operator sees the result of a
// real PAN/Aadhaar before shipping the policy. Detection (recognizers/thresholds) is a separate
// surface; this only decides the replacement.

const OP_HELP: Record<AnonymizeOperator, string> = {
  replace: 'Substitute a fixed token (e.g. <PAN>). Blank uses Presidio’s default <ENTITY> tag.',
  redact: 'Remove the value entirely.',
  mask: 'Replace part of the value with a character, revealing the rest.',
  hash: 'Irreversibly hash the value (join-able, never readable).',
  encrypt: 'Reversibly encrypt with an AES key (16 / 24 / 32 chars).',
  keep: 'Leave the value untouched (allow-list this entity).',
};

interface Row {
  entity: string;
  spec: OperatorSpec;
}

const NEW_SPEC: OperatorSpec = { type: 'mask', maskingChar: '*', charsToMask: 4, fromEnd: false };

interface TestResult {
  status: string;
  configured: boolean;
  original: string;
  text: string;
  entities: string[];
  items: { entityType: string; operator: string; text: string }[];
  reason?: string;
}

export function PresidioAnonymizers({
  policy,
  imageRedactionAvailable,
}: Readonly<{ policy: AnonymizerPolicy; imageRedactionAvailable: boolean }>) {
  const router = useRouter();
  const [def, setDef] = useState<OperatorSpec>(policy.default);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(policy.perEntity).map(([entity, spec]) => ({ entity, spec })),
  );
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState('Customer PAN ABCDE1234F, Aadhaar 2345 6789 0123, card 4111 1111 1111 1111');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  function addRow() {
    setRows((rs) => [...rs, { entity: '', spec: { ...NEW_SPEC } }]);
  }
  function setRowEntity(i: number, entity: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, entity } : r)));
  }
  function setRowSpec(i: number, spec: OperatorSpec) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, spec } : r)));
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    const perEntity: Record<string, OperatorSpec> = {};
    for (const r of rows) {
      const key = r.entity.trim().toUpperCase();
      if (key) perEntity[key] = r.spec;
    }
    const res = await fetch('/api/v1/admin/governance/masking/policy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default: def, perEntity }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Masking policy saved');
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? 'Failed to save masking policy');
    }
  }

  async function runTest() {
    if (!probe.trim()) return;
    setTesting(true);
    const res = await fetch('/api/v1/admin/governance/masking/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: probe }),
    });
    setTesting(false);
    if (res.ok) {
      setResult((await res.json()) as TestResult);
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? 'Test failed');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Policy editor ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Decide how each detected entity is transformed on the data-movement path. Per-entity
          operators override the default; anything without an override uses the default operator.
        </p>

        <div className="space-y-2 rounded-md border border-border p-4">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Default (all other entities)
          </Label>
          <OperatorEditor spec={def} onChange={setDef} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Per-entity operators</Label>
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="size-4" />
              Add entity
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No per-entity overrides yet — every detected entity uses the default operator.
            </p>
          ) : (
            rows.map((r, i) => (
              <div key={i} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={r.entity}
                    placeholder="IN_PAN"
                    className="flex-1 font-mono"
                    onChange={(e) => setRowEntity(i, e.target.value)}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeRow(i)} title="Remove">
                    <Trash className="size-4" />
                  </Button>
                </div>
                <OperatorEditor spec={r.spec} onChange={(s) => setRowSpec(i, s)} />
              </div>
            ))
          )}
        </div>

        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save masking policy'}
        </Button>
      </div>

      {/* ── Live test + image-redaction honesty ───────────────────────── */}
      <div className="space-y-4">
        <div className="space-y-2 rounded-md border border-border p-4">
          <Label htmlFor="mask-probe">Test the policy on real text</Label>
          <Textarea
            id="mask-probe"
            value={probe}
            className="font-mono text-xs"
            rows={3}
            onChange={(e) => setProbe(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Runs the live detect → anonymize flow with the SAVED policy. Save first to test edits.
            Nothing is stored.
          </p>
          <Button onClick={runTest} disabled={testing}>
            {testing ? 'Running…' : 'Run test'}
          </Button>

          {result ? (
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={result.status} configured={result.configured} />
                {result.entities.length ? (
                  <span className="font-mono text-muted-foreground">
                    {result.entities.join(', ')}
                  </span>
                ) : (
                  <span className="text-muted-foreground">no entities detected</span>
                )}
              </div>
              {result.reason ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">{result.reason}</p>
              ) : null}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Input</p>
                <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
                  {result.original}
                </pre>
                <p className="text-xs text-muted-foreground">Masked output</p>
                <pre className="overflow-x-auto rounded bg-primary/5 p-2 font-mono text-xs text-foreground">
                  {result.text}
                </pre>
              </div>
              {result.items.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>Operator</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.items.map((it, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{it.entityType}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{it.operator}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[20ch] truncate font-mono text-xs" title={it.text}>
                          {it.text}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Image redaction — the real upload → redact → review surface */}
        <EncryptionKeyPanel usesEncrypt={policyUsesEncrypt(policy)} />
        <ImageRedactionPanel available={imageRedactionAvailable} />
      </div>
    </div>
  );
}

function StatusBadge({ status, configured }: Readonly<{ status: string; configured: boolean }>) {
  if (!configured) return <Badge variant="secondary">engine not configured</Badge>;
  if (status === 'applied') return <Badge>masked</Badge>;
  if (status === 'down') return <Badge variant="destructive">engine down</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

// A single operator editor: the operator picker + only the params that operator uses. Reuses the
// pure catalog/labels so the operator set never drifts from what the engine supports.
function OperatorEditor({
  spec,
  onChange,
}: Readonly<{ spec: OperatorSpec; onChange: (s: OperatorSpec) => void }>) {
  const selectId = useId();
  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  function setType(type: AnonymizeOperator) {
    // Reset to that operator's sensible defaults when the operator changes.
    switch (type) {
      case 'mask':
        onChange({ type, maskingChar: '*', charsToMask: 4, fromEnd: false });
        break;
      case 'hash':
        onChange({ type, hashType: 'sha256' });
        break;
      case 'encrypt':
        // No inline key: a keyless encrypt spec means "use the org's vaulted key".
        onChange({ type });
        break;
      case 'replace':
        onChange({ type, newValue: '' });
        break;
      default:
        onChange({ type });
    }
  }

  return (
    <div className="space-y-2">
      <select
        id={selectId}
        aria-label="Operator"
        className={selectClass}
        value={spec.type}
        onChange={(e) => setType(e.target.value as AnonymizeOperator)}
      >
        {ANONYMIZE_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{OP_HELP[spec.type]}</p>

      {spec.type === 'replace' ? (
        <Input
          value={spec.newValue ?? ''}
          placeholder="<PAN>  (blank = <ENTITY>)"
          className="font-mono"
          onChange={(e) => onChange({ type: 'replace', newValue: e.target.value })}
        />
      ) : null}

      {spec.type === 'mask' ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Char</Label>
            <Input
              value={spec.maskingChar ?? '*'}
              maxLength={2}
              className="w-14 font-mono"
              onChange={(e) =>
                onChange({ ...spec, type: 'mask', maskingChar: e.target.value || '*' })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs"># chars</Label>
            <Input
              type="number"
              min={1}
              value={spec.charsToMask ?? 4}
              className="w-20"
              onChange={(e) =>
                onChange({ ...spec, type: 'mask', charsToMask: Number(e.target.value) || 1 })
              }
            />
          </div>
          <label className="flex items-center gap-2 pb-1.5 text-xs">
            <Switch
              checked={spec.fromEnd === true}
              onCheckedChange={(v) => onChange({ ...spec, type: 'mask', fromEnd: v })}
            />
            from end
          </label>
        </div>
      ) : null}

      {spec.type === 'hash' ? (
        <select
          aria-label="Hash type"
          className={selectClass}
          value={spec.hashType ?? 'sha256'}
          onChange={(e) => onChange({ type: 'hash', hashType: e.target.value as HashType })}
        >
          {HASH_TYPES.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      ) : null}

      {spec.type === 'encrypt' ? (
        // The AES key is NEVER typed or stored here — it is generated into the secrets store and
        // bound at scan time. Manage it with "Encryption key" below.
        <p className="rounded border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          Uses the organization&rsquo;s encryption key from the secrets store. Manage it under
          <span className="text-foreground"> Encryption key</span> below.
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">{describeOperator(spec)}</p>
    </div>
  );
}

// ─── Encryption key — the vault-backed AES key for the `encrypt` operator ─────────────────────────
// The key is generated server-side into the secrets store and NEVER returned, so this panel only ever
// shows whether one is configured. Without a key an encrypt operator degrades to masking (the value is
// still redacted, never plaintext) — stated plainly rather than failing silently.
function EncryptionKeyPanel({ usesEncrypt }: Readonly<{ usesEncrypt: boolean }>) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch('/api/v1/admin/governance/masking/encrypt-key')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live) setConfigured(j ? Boolean(j.configured) : null);
      })
      .catch(() => {
        if (live) setConfigured(null);
      });
    return () => {
      live = false;
    };
  }, []);

  async function generate(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/governance/masking/encrypt-key', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { configured?: boolean; rotated?: boolean; error?: string };
      if (!res.ok) {
        toast.error(body.error ?? 'Could not store the key');
        return;
      }
      setConfigured(Boolean(body.configured));
      toast.success(body.rotated ? 'Encryption key rotated' : 'Encryption key generated');
    } catch {
      toast.error('Could not reach the secrets store');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Encryption key</span>
        <Badge variant={configured ? 'default' : 'secondary'}>
          {configured === null ? 'unknown' : configured ? 'configured' : 'not set'}
        </Badge>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={generate} disabled={busy}>
          {busy ? 'Working…' : configured ? 'Rotate key' : 'Generate key'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Generated on the server and held in the secrets store — it is never displayed or downloadable.
        {usesEncrypt && configured === false
          ? ' Your policy encrypts an entity but no key is set, so those values are masked instead until you generate one.'
          : ' Required only by the encrypt operator; without it, encrypt degrades to masking.'}
      </p>
    </div>
  );
}
