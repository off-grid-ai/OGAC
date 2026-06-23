import { NextResponse } from 'next/server';
import { getGrounding } from '@/lib/adapters/registry';
import type { GroundingSource } from '@/lib/adapters/types';

// Standalone grounding: verify an answer against caller-supplied sources. No Brain, no store —
// a customer can verify their OWN RAG stack's answers through this endpoint alone.
interface Body {
  answer?: unknown;
  sources?: unknown;
}

function parseSource(s: unknown): GroundingSource | null {
  const text = typeof s === 'string' ? s : (s as { text?: unknown })?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const id = typeof s === 'object' && s ? (s as { id?: string }).id : undefined;
  return { id, text };
}

function parseSources(raw: unknown): GroundingSource[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.map(parseSource);
  return out.includes(null) ? null : (out as GroundingSource[]);
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Body | null;
  const sources = parseSources(b?.sources);
  if (!b || typeof b.answer !== 'string' || !b.answer.trim() || !sources || sources.length === 0) {
    return NextResponse.json(
      { error: 'answer (string) and sources (non-empty array of {text}) required' },
      { status: 400 },
    );
  }
  const result = await getGrounding().verify(b.answer, sources);
  return NextResponse.json(result);
}
