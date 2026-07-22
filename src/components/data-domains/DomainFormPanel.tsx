'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { validateDomainForm, type DomainFormResult } from '@/lib/data-domains-ui';

const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm';

export interface ConnectorOption {
  id: string;
  name: string;
  type: string;
  /** Optional server-owned endpoint metadata used by bounded internal-action pickers. */
  endpoint?: string;
}

export interface DomainDraft {
  label: string;
  connectorId: string;
  resource: string;
  aliasesRaw: string;
}

// The shared create/edit form for a data-domain rule, rendered inside a URL-driven Sheet. It owns
// only the transient input state; whether it's open (and for which id) is decided by the parent
// from the URL. On save it validates via the SAME pure rule the server uses, then POSTs/PATCHes.
export function DomainFormPanel({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  connectors,
  initial,
  submitUrl,
  method,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  connectors: ConnectorOption[];
  initial: DomainDraft;
  submitUrl: string;
  method: 'POST' | 'PATCH';
  onSaved: () => void;
}>) {
  const [label, setLabel] = useState(initial.label);
  const [connectorId, setConnectorId] = useState(initial.connectorId);
  const [resource, setResource] = useState(initial.resource);
  const [aliasesRaw, setAliasesRaw] = useState(initial.aliasesRaw);
  const [errors, setErrors] = useState<DomainFormResult['errors']>({});
  const [busy, setBusy] = useState(false);

  // Reseed from `initial` each time the panel opens so a stale draft never lingers.
  useEffect(() => {
    if (open) {
      setLabel(initial.label);
      setConnectorId(initial.connectorId);
      setResource(initial.resource);
      setAliasesRaw(initial.aliasesRaw);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (busy) return;
    const result = validateDomainForm({ label, connectorId, resource, aliasesRaw });
    if (!result.ok || !result.value) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    const res = await fetch(submitUrl, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result.value),
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Data domain "${result.value.label}" ${method === 'POST' ? 'created' : 'updated'}`);
      onOpenChange(false);
      onSaved();
    } else {
      toast.error(`Failed to ${method === 'POST' ? 'create' : 'update'} data domain`);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <Button onClick={save} disabled={busy} className="w-full">
          {submitLabel}
        </Button>
      }
    >
      <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dom-label">Label</Label>
            <Input
              id="dom-label"
              placeholder="customer data"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {errors.label ? <p className="text-xs text-destructive">{errors.label}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dom-aliases">Aliases</Label>
            <Textarea
              id="dom-aliases"
              rows={2}
              placeholder="customers, accounts, contacts"
              value={aliasesRaw}
              onChange={(e) => setAliasesRaw(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Other phrases that mean the same thing — comma or newline separated.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dom-connector">Connector</Label>
            <select
              id="dom-connector"
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              className={SELECT}
            >
              <option value="">Select a connector…</option>
              {connectors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.type})
                </option>
              ))}
            </select>
            {errors.connectorId ? (
              <p className="text-xs text-destructive">{errors.connectorId}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dom-resource">Resource</Label>
            <Input
              id="dom-resource"
              placeholder="Account · transactions · invoices/"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              The table, object, or path within the connector this label reads from.
            </p>
            {errors.resource ? <p className="text-xs text-destructive">{errors.resource}</p> : null}
          </div>
      </div>
    </FormSheet>
  );
}
