import { NextResponse } from 'next/server';
import { BankCrossSellContextUnavailableError } from '@/lib/adapters/bank-cross-sell-context';
import { BankCrossSellExecutionError } from '@/lib/adapters/bank-cross-sell-execution';
import { pipelineBindingHttpFailure } from '@/lib/pipeline-binding-http';

export function bankCrossSellErrorResponse(error: unknown): NextResponse {
  if (error instanceof BankCrossSellContextUnavailableError) {
    return NextResponse.json(
      {
        error: `${error.source} is not available. No recommendation was generated.`,
        code: error.code,
      },
      { status: 409 },
    );
  }
  if (error instanceof BankCrossSellExecutionError) {
    const status =
      error.code === 'app-not-found' ||
      error.code === 'customer-not-found' ||
      error.code === 'run-not-found'
        ? 404
        : error.code === 'runtime-unavailable'
          ? 503
          : 409;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  const pipeline = pipelineBindingHttpFailure(error);
  if (pipeline) return NextResponse.json(pipeline.body, { status: pipeline.status });
  console.error('cross-sell journey failed:', error);
  return NextResponse.json(
    { error: 'The cross-sell journey could not be completed', code: 'internal-error' },
    { status: 500 },
  );
}
