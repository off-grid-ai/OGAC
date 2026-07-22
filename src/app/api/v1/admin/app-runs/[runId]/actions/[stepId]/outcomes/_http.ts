import { NextResponse } from 'next/server';
import {
  ActionOutcomeConflictError,
  ActionOutcomeNotFoundError,
  ActionOutcomeValidationError,
} from '@/lib/action-outcome-observation-store';

export function actionOutcomeErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ActionOutcomeValidationError) {
    return NextResponse.json(
      { error: 'invalid business result', errors: error.errors },
      { status: 400 },
    );
  }
  if (error instanceof ActionOutcomeNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ActionOutcomeConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return null;
}
