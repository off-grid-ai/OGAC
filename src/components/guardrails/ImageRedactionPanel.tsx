'use client';

import { ImageSquare, ShieldCheck, Upload } from '@phosphor-icons/react/dist/ssr';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type ImageRedactionEvidence,
  imageRedactionMediaTypeFor,
  imageRedactionUploadError,
  summarizeRedactionResult,
} from '@/lib/image-redaction';

// The OPERATOR-facing image redaction surface: upload a KYC document image (an OVD scan), redact the
// PII regions through the governed /api/v1/governance/image-redaction route (which drives the live
// Presidio image-redactor + Tesseract OCR, records an audited receipt), and REVIEW the redacted image
// + the detected entities + the tamper-evident receipt. This is the real management surface — not a
// status badge. Pure validation/summary (imageRedactionUploadError / summarizeRedactionResult) is
// isolated + unit-tested in lib/image-redaction; this component is the thin upload/render glue.

interface RedactionResponse {
  redactedImageBase64: string;
  mediaType: string;
  evidence: ImageRedactionEvidence;
}

// Read a File to canonical base64 (strip the data: prefix) in the browser.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function ImageRedactionPanel({ available }: Readonly<{ available: boolean }>) {
  const inputId = useId();
  const purposeId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [purpose, setPurpose] = useState('KYC document redaction');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RedactionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return (
      <div className="space-y-1 rounded-md border border-dashed border-border p-4">
        <div className="flex items-center gap-2">
          <ImageSquare className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Document image redaction</span>
          <Badge variant="secondary">engine not deployed</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Redacting PII from KYC document images (OVDs) needs the Presidio image-redactor service,
          which is not part of this deployment. Text masking above is fully live.
        </p>
      </div>
    );
  }

  async function onRedact(): Promise<void> {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a PNG or JPEG image first.');
      return;
    }
    const fileError = imageRedactionUploadError({ type: file.type, size: file.size });
    if (fileError) {
      setError(fileError);
      return;
    }
    if (purpose.trim().length < 3) {
      setError('Enter a purpose (why this document is being redacted) — 3 characters or more.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await fetch('/api/v1/governance/image-redaction', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mediaType: imageRedactionMediaTypeFor(file.type),
          purpose: purpose.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<RedactionResponse> & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Redaction failed (HTTP ${res.status}).`);
        return;
      }
      setResult(body as RedactionResponse);
      toast.success('Image redacted');
    } catch {
      setError('Could not reach the redaction service.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-center gap-2">
        <ImageSquare className="size-4 text-primary" />
        <span className="text-sm font-medium">Document image redaction</span>
        <Badge>available</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a KYC document image (an OVD scan). PII regions are detected by OCR and blacked out
        before the file moves; the original never leaves this request. Every redaction records a
        tamper-evident receipt in the audit log.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={inputId} className="text-xs">
              Document image (PNG or JPEG, up to 8 MiB)
            </Label>
            <Input
              id={inputId}
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="text-xs"
              onChange={() => {
                setError(null);
                setResult(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={purposeId} className="text-xs">
              Purpose
            </Label>
            <Input
              id={purposeId}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Why is this document being redacted?"
              className="text-xs"
            />
          </div>
          <Button type="button" size="sm" onClick={onRedact} disabled={busy}>
            <Upload className="size-4" />
            {busy ? 'Redacting…' : 'Redact PII'}
          </Button>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" weight="fill" />
              <span className="text-sm font-medium">{summarizeRedactionResult(result.evidence)}</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:${result.mediaType};base64,${result.redactedImageBase64}`}
              alt="Redacted document — PII regions blacked out"
              className="max-h-72 w-auto rounded border border-border"
            />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>Engine</dt>
              <dd className="text-foreground">
                {result.evidence.engine} {result.evidence.engineVersion}
              </dd>
              <dt>OCR</dt>
              <dd className="text-foreground">{result.evidence.ocrEngine}</dd>
              <dt>Detected</dt>
              <dd className="text-foreground">
                {result.evidence.entities.length
                  ? result.evidence.entities
                      .map((e) => `${e.entityType} ×${e.count}`)
                      .join(', ')
                  : 'none'}
              </dd>
              <dt>Duration</dt>
              <dd className="text-foreground">{result.evidence.durationMs} ms</dd>
              <dt>Receipt</dt>
              <dd className="break-all font-mono text-[11px] text-foreground">
                {result.evidence.policy.receiptId}
              </dd>
            </dl>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded border border-dashed border-border p-6 text-xs text-muted-foreground">
            The redacted image and its evidence receipt appear here.
          </div>
        )}
      </div>
    </div>
  );
}
