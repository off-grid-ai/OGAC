import 'server-only';
import { createC2pa, createTestSigner, ManifestBuilder } from 'c2pa-node';

// C2PA Content Credentials for IMAGE assets (the format's actual domain — PNG / JPEG). Embeds a
// tamper-evident, offline-verifiable manifest (who/what/when, signed) into an image, and reads it
// back. Uses a bundled test signer by default (no fees, no API keys, no external CA) — set
// OFFGRID_C2PA_CERT + OFFGRID_C2PA_KEY (PEM) for a real signing identity in production.
//
// NOTE: C2PA signs media, not text — report/document exports use the ed25519 detached manifest
// (src/lib/sign.ts) instead. This module is the `c2pa` provenance adapter for images.
const CLAIM_GENERATOR = 'offgrid-console/1.0';
const SUPPORTED = new Set(['image/png', 'image/jpeg']);

export function c2paSupported(mimeType: string): boolean {
  return SUPPORTED.has(mimeType);
}

// A local signer from env-provided PEM cert+key, or the bundled test signer (dev/eval default).
async function getSigner() {
  const cert = process.env.OFFGRID_C2PA_CERT;
  const key = process.env.OFFGRID_C2PA_KEY;
  if (cert && key) {
    const { SigningAlgorithm } = await import('c2pa-node');
    return {
      type: 'local' as const,
      certificate: Buffer.from(cert),
      privateKey: Buffer.from(key),
      algorithm: SigningAlgorithm.ES256,
      tsaUrl: process.env.OFFGRID_C2PA_TSA_URL,
    };
  }
  return createTestSigner();
}

export interface C2paSignResult {
  buffer: Buffer;
  bytes: number;
}

// Embed Content Credentials into an image asset, attributing it to this org + a CreativeWork
// assertion. Returns the signed image bytes (the original is never mutated in place).
export async function c2paSign(
  buffer: Buffer,
  mimeType: string,
  opts: { title?: string; author?: string } = {},
): Promise<C2paSignResult> {
  if (!c2paSupported(mimeType)) {
    throw new Error(`c2pa: unsupported asset type ${mimeType} (png/jpeg only)`);
  }
  const signer = await getSigner();
  const c2pa = createC2pa({ signer });
  const manifest = new ManifestBuilder({
    claim_generator: CLAIM_GENERATOR,
    format: mimeType,
    title: opts.title ?? 'Off Grid asset',
    assertions: [
      {
        label: 'stds.schema-org.CreativeWork',
        data: {
          '@context': 'https://schema.org',
          '@type': 'CreativeWork',
          author: [{ '@type': 'Organization', name: opts.author ?? 'Off Grid Console' }],
        },
      },
    ],
  });
  const { signedAsset } = await c2pa.sign({ asset: { buffer, mimeType }, manifest });
  return { buffer: signedAsset.buffer, bytes: signedAsset.buffer.length };
}

export interface C2paReadResult {
  hasManifest: boolean;
  valid: boolean;
  activeManifest?: string;
  validationStatus: unknown;
  manifest?: unknown;
}

// Read + validate the Content Credentials embedded in an image. `valid` is true when C2PA reports
// no validation failures (an empty validation_status means a clean, untampered manifest).
export async function c2paRead(buffer: Buffer, mimeType: string): Promise<C2paReadResult> {
  const c2pa = createC2pa();
  const result = (await c2pa.read({ buffer, mimeType })) as unknown as {
    active_manifest?: { label?: string } | null;
    validation_status?: { code?: string }[];
  } | null;
  if (!result) return { hasManifest: false, valid: false, validationStatus: null };
  const status = result.validation_status ?? [];
  const active = result.active_manifest ?? undefined;
  const failures = status.filter((s) => s?.code?.includes('error'));
  return {
    hasManifest: Boolean(active),
    valid: failures.length === 0,
    activeManifest: active?.label,
    validationStatus: status,
    manifest: active,
  };
}

export async function c2paHealth(): Promise<boolean> {
  try {
    await getSigner();
    return true;
  } catch {
    return false;
  }
}
