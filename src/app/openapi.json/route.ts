import { NextResponse } from 'next/server';
import { openApiSpec } from '@/lib/openapi';

// The machine-readable contract. "API only" customers point their SDKs/codegen at this.
export function GET() {
  return NextResponse.json(openApiSpec);
}
