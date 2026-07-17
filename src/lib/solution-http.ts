import { NextResponse } from 'next/server';
import { SolutionConflictError, SolutionValidationError } from '@/lib/solution-blueprints-store';

export function solutionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SolutionValidationError) {
    return NextResponse.json(
      { error: 'invalid solution contract', errors: error.errors },
      { status: 422 },
    );
  }
  if (error instanceof SolutionConflictError) {
    return NextResponse.json(
      { error: error.message, code: error.code, errors: error.errors },
      { status: 409 },
    );
  }
  return null;
}
