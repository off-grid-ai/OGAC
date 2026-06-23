import { NextResponse } from 'next/server';
import { runEval } from '@/lib/evals';

// Run the golden set against the Brain's retrieval and record a scored eval run.
export async function POST() {
  return NextResponse.json(await runEval(), { status: 201 });
}
