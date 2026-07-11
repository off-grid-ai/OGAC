'use client';

import { SealCheck, ShieldCheck } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface KeyInfo {
  algorithm: string;
  publicKey: string | null;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function PublicKeyFooter({ info }: Readonly<{ info: KeyInfo | null }>) {
  if (!info?.publicKey) return null;
  return (
    <div className="space-y-1.5 lg:col-span-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        Public verification key
      </span>
      <code className="block break-all rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
        {info.publicKey}
      </code>
    </div>
  );
}

function KeyDescription({ info }: Readonly<{ info: KeyInfo | null }>) {
  if (!info) return <>Loading signing key…</>;
  const note = info.publicKey
    ? 'Public-key — third parties verify with the key below, no shared secret.'
    : 'Shared-secret MAC — verification needs the signing key.';
  return (
    <>
      Active algorithm <span className="text-foreground">{info.algorithm}</span>. {note}
    </>
  );
}

// Provenance signing / verification, on top of POST|GET /api/v1/admin/sign. ed25519 (the public-key
// adapter) lets a third party verify with only the public key — no shared secret.
export function ProvenancePanel() {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [payload, setPayload] = useState('{"answer":"The policy is in force.","refs":["kb:1"]}');
  const [signature, setSignature] = useState('');
  const [verifyPayload, setVerifyPayload] = useState('');
  const [verifySig, setVerifySig] = useState('');
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/admin/sign')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  async function sign() {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/admin/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: parse(payload) }),
      });
      const data = (await res.json()) as { signature?: string };
      if (!data.signature) throw new Error('no signature');
      setSignature(data.signature);
      setVerifyPayload(payload);
      setVerifySig(data.signature);
      toast.success('Signed');
    } catch {
      toast.error('Sign failed');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setVerdict(null);
    try {
      const res = await fetch('/api/v1/admin/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: parse(verifyPayload), signature: verifySig }),
      });
      const data = (await res.json()) as { valid?: boolean };
      setVerdict(Boolean(data.valid));
    } catch {
      toast.error('Verify failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-primary" />
          Provenance · sign &amp; verify
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          <KeyDescription info={info} />
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prov-payload">Payload</Label>
          <Textarea
            id="prov-payload"
            rows={4}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
          <Button size="sm" onClick={sign} disabled={busy} className="w-full">
            <SealCheck className="size-4" />
            Sign
          </Button>
          {signature ? (
            <code className="block break-all rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
              {signature}
            </code>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="ver-payload">Verify payload</Label>
          <Textarea
            id="ver-payload"
            rows={2}
            value={verifyPayload}
            onChange={(e) => setVerifyPayload(e.target.value)}
          />
          <Label htmlFor="ver-sig">Signature</Label>
          <Textarea
            id="ver-sig"
            rows={2}
            value={verifySig}
            onChange={(e) => setVerifySig(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={verify}
            disabled={busy || !verifyPayload || !verifySig}
            className="w-full"
          >
            Verify signature
          </Button>
          {verdict !== null ? (
            <Badge
              variant="secondary"
              className={verdict ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}
            >
              {verdict ? 'valid — untampered' : 'invalid — tampered or wrong key'}
            </Badge>
          ) : null}
        </div>

        <PublicKeyFooter info={info} />
      </CardContent>
    </Card>
  );
}
