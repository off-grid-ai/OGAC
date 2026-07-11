'use client';

import { ArrowClockwise, Envelope, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { panelHref, withPanelParams } from '@/lib/url-panel';

interface DnsRecord {
  purpose: string;
  type: string;
  name: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}
interface SendingDomain {
  id: string;
  domain: string;
  status: string;
  region?: string;
  records: DnsRecord[];
}
interface InboundAddress {
  id: string;
  label: string;
  targetKind: string;
  targetId: string;
  inboundAddress: string | null;
  enabled: boolean;
}

// ─── Messaging management — the email consumption I/O surface ──────────────────────────────────────
// Three governed sections, all full-width: the vaulted Resend key, self-serve sending-domain verify
// (list → the selected domain's DNS records the customer pastes into THEIR OWN DNS), and forward-to-
// address inbound (a unique <token>@inbound.<host> per app/agent). Panels + the selected domain live
// in the URL (?panel=… / ?domain=…) so Back is coherent and views are deep-linkable.
export function MessagingManager() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [keyState, setKeyState] = useState<{ configured: boolean; from: string | null } | null>(null);
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [inbound, setInbound] = useState<{
    configured: boolean;
    domain: string | null;
    setup: string;
    data: InboundAddress[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const [keyInput, setKeyInput] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [addrTarget, setAddrTarget] = useState('');
  const [addrKind, setAddrKind] = useState('app');

  const panel = params.get('panel');
  const selectedDomainId = params.get('domain');
  const selectedDomain = domains.find((d) => d.id === selectedDomainId) ?? null;

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const qs = withPanelParams(params.toString(), patch);
      router.replace(panelHref(pathname, qs), { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(async () => {
    const [k, d, i] = await Promise.all([
      fetch('/api/v1/admin/messaging/resend/key').then((r) => r.json()).catch(() => null),
      fetch('/api/v1/admin/messaging/resend/domains').then((r) => r.json()).catch(() => null),
      fetch('/api/v1/admin/messaging/inbound').then((r) => r.json()).catch(() => null),
    ]);
    if (k) setKeyState({ configured: !!k.configured, from: k.from ?? null });
    if (d?.data) setDomains(d.data);
    if (i) setInbound({ configured: !!i.configured, domain: i.domain ?? null, setup: i.setup ?? '', data: i.data ?? [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/messaging/resend/key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: keyInput.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Resend API key stored in the vault');
      setKeyInput('');
      setParam({ panel: null });
      void load();
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Failed to store key');
    }
  }

  async function registerDomain() {
    if (!domainInput.trim()) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/messaging/resend/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: domainInput.trim() }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      toast.success('Domain registered — add the DNS records to your DNS, then verify');
      setDomainInput('');
      await load();
      setParam({ panel: null, domain: body.id });
    } else {
      toast.error(body.error ?? 'Failed to register domain');
    }
  }

  async function checkDomain(id: string) {
    setBusy(true);
    const res = await fetch(`/api/v1/admin/messaging/resend/domains/${id}`, { method: 'POST' });
    setBusy(false);
    if (res.ok) {
      toast.success('Verification re-checked');
      void load();
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Verify failed');
    }
  }

  async function deleteDomain(id: string) {
    if (!confirm('Delete this sending domain registration?')) return;
    const res = await fetch(`/api/v1/admin/messaging/resend/domains/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Domain deleted');
      setParam({ domain: null });
      void load();
    } else {
      toast.error('Delete failed');
    }
  }

  async function createInbound() {
    if (!addrTarget.trim()) return;
    setBusy(true);
    const res = await fetch('/api/v1/admin/messaging/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetKind: addrKind, targetId: addrTarget.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success('Inbound address created');
      setAddrTarget('');
      setParam({ panel: null });
      void load();
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Failed to create address');
    }
  }

  const statusVariant = (s: string) => {
    if (s === 'verified') return 'default';
    if (s === 'failed') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="w-full space-y-6">
      {/* Resend API key — vaulted */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Resend API key (vaulted)</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={keyState?.configured ? 'default' : 'secondary'}>
              {keyState?.configured ? 'configured' : 'not set'}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => setParam({ panel: 'resend-key' })}>
              {keyState?.configured ? 'Rotate key' : 'Set key'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The API key is stored in the secrets vault and never displayed. Sender:{' '}
          <span className="font-mono text-foreground">{keyState?.from ?? 'set RESEND_FROM'}</span>.
          Outbound email is PII-masked and egress-leashed before it leaves the box.
        </CardContent>
      </Card>

      {/* Sending domains — list → detail (records) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Sending domains</CardTitle>
            <Button size="sm" onClick={() => setParam({ panel: 'add-domain' })}>
              <Plus className="mr-1 size-4" /> Add domain
            </Button>
          </CardHeader>
          <CardContent>
            {domains.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sending domains yet. Add your domain, paste the DNS records we return into your own
                DNS, then verify. We never touch your DNS.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => setParam({ domain: d.id })}
                    >
                      <TableCell className="font-mono">{d.domain}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            void checkDomain(d.id);
                          }}
                        >
                          <ArrowClockwise className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detail: the selected domain's DNS records (SPF/DKIM/DMARC/return-path) to paste */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {selectedDomain ? `DNS records — ${selectedDomain.domain}` : 'DNS records'}
            </CardTitle>
            {selectedDomain && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => checkDomain(selectedDomain.id)}>
                  <ArrowClockwise className="mr-1 size-4" /> Verify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteDomain(selectedDomain.id)}>
                  <Trash className="size-4" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!selectedDomain ? (
              <p className="text-sm text-muted-foreground">
                Select a domain to see the exact SPF / DKIM / DMARC / return-path records to add to
                your DNS.
              </p>
            ) : selectedDomain.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No records returned yet — re-check status.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDomain.records.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge variant="outline">{r.purpose}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.type}
                          {r.priority !== undefined ? ` (pri ${r.priority})` : ''}
                        </TableCell>
                        <TableCell className="font-mono text-xs break-all">{r.name}</TableCell>
                        <TableCell className="font-mono text-xs break-all">{r.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Forward-to-address inbound */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Inbound email addresses</CardTitle>
          <Button size="sm" onClick={() => setParam({ panel: 'add-inbound' })}>
            <Envelope className="mr-1 size-4" /> New address
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {inbound?.configured
              ? inbound.setup
              : 'Inbound is disabled. Configure an inbound email domain in Settings, then create addresses here.'}
          </p>
          {inbound && inbound.data.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inbound.data.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs break-all">
                        {a.inboundAddress ?? '(set inbound domain)'}
                      </TableCell>
                      <TableCell>
                        {a.targetKind}:{a.targetId}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.enabled ? 'default' : 'secondary'}>
                          {a.enabled ? 'on' : 'off'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Panels ── */}
      <FormSheet
        open={panel === 'resend-key'}
        onOpenChange={(o) => setParam({ panel: o ? 'resend-key' : null })}
        title="Resend API key"
        description="Stored in the vault; never displayed. Env RESEND_API_KEY is the bootstrap fallback."
        footer={
          <Button onClick={saveKey} disabled={busy || !keyInput.trim()}>
            Save to vault
          </Button>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="resend-key">API key</Label>
          <Input
            id="resend-key"
            type="password"
            placeholder="re_…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
        </div>
      </FormSheet>

      <FormSheet
        open={panel === 'add-domain'}
        onOpenChange={(o) => setParam({ panel: o ? 'add-domain' : null })}
        title="Add sending domain"
        description="We register it with the sender and return the DNS records for YOU to add to your own DNS."
        footer={
          <Button onClick={registerDomain} disabled={busy || !domainInput.trim()}>
            Register
          </Button>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            placeholder="mail.yourco.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
          />
        </div>
      </FormSheet>

      <FormSheet
        open={panel === 'add-inbound'}
        onOpenChange={(o) => setParam({ panel: o ? 'add-inbound' : null })}
        title="New inbound address"
        description="Mints a unique <token>@inbound.<host> address bound to an app or agent."
        footer={
          <Button onClick={createInbound} disabled={busy || !addrTarget.trim()}>
            Create address
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Target kind</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={addrKind}
              onChange={(e) => setAddrKind(e.target.value)}
            >
              <option value="app">app</option>
              <option value="agent">agent</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">Target id</Label>
            <Input
              id="target"
              placeholder="app_… or agent id"
              value={addrTarget}
              onChange={(e) => setAddrTarget(e.target.value)}
            />
          </div>
        </div>
      </FormSheet>
    </div>
  );
}
