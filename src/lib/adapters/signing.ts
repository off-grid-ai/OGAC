import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';
import { sign as hmacSign, verify as hmacVerify } from '@/lib/sign';
import { PROVENANCE } from './services';
import type { SigningPort } from './types';

// Provenance signing behind one port. `native` (HMAC, default) keeps the existing shared-secret
// MAC; `ed25519` produces asymmetric signatures that anyone can verify with just the PUBLIC key —
// the property real provenance needs (a regulator/auditor verifies without holding our secret).
// Selected via OFFGRID_ADAPTER_PROVENANCE. C2PA/Sigstore are heavier future swaps behind this port.
const env = process.env;

function metaOf(id: string) {
  const entry = PROVENANCE.find((e) => e.meta.id === id);
  if (!entry) throw new Error(`provenance adapter meta '${id}' missing`);
  return entry.meta;
}

function canonical(payload: unknown): string {
  return JSON.stringify(payload);
}

export const hmacSigning: SigningPort = {
  meta: metaOf('native'),
  algorithm: 'HMAC-SHA256',
  sign: hmacSign,
  verify: hmacVerify,
  publicKey: () => null,
};

// Load an ed25519 private key from PEM in env (production), else generate a process-stable pair so
// dev works out of the box. The public half is derived from the private key either way.
function loadKeys(): { privateKey: KeyObject; publicKey: KeyObject } {
  const pem = env.OFFGRID_ED25519_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (pem) {
    const privateKey = createPrivateKey(pem);
    return { privateKey, publicKey: createPublicKey(privateKey) };
  }
  return generateKeyPairSync('ed25519');
}

const keys = loadKeys();

export const ed25519Signing: SigningPort = {
  meta: metaOf('ed25519'),
  algorithm: 'Ed25519',
  sign(payload) {
    const sig = cryptoSign(null, Buffer.from(canonical(payload)), keys.privateKey);
    return `ed25519_${sig.toString('base64')}`;
  },
  verify(payload, signature) {
    if (!signature.startsWith('ed25519_')) return false;
    try {
      const sig = Buffer.from(signature.slice('ed25519_'.length), 'base64');
      return cryptoVerify(null, Buffer.from(canonical(payload)), keys.publicKey, sig);
    } catch {
      return false;
    }
  },
  publicKey: () => keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};

export const SIGNING_PORTS: SigningPort[] = [hmacSigning, ed25519Signing];
