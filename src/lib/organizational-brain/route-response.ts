import { NextResponse } from 'next/server';
import {
  BrainAuthorizationError,
  BrainDocumentValidationError,
  BrainPolicyError,
  OrganizationalBrainProviderError,
} from '@/lib/organizational-brain/contracts';
import { BrainRequestError } from '@/lib/organizational-brain/requests';

export function organizationalBrainErrorResponse(error: unknown): NextResponse {
  if (error instanceof BrainAuthorizationError) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (error instanceof BrainRequestError || error instanceof BrainDocumentValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof BrainPolicyError) {
    return NextResponse.json({ error: 'organizational brain is not configured' }, { status: 503 });
  }
  if (error instanceof OrganizationalBrainProviderError) {
    if (error.failure === 'notFound') return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ error: 'organizational brain is unavailable' }, { status: 502 });
  }
  return NextResponse.json({ error: 'invalid organizational-brain request' }, { status: 400 });
}
