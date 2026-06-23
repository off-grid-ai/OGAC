import { NextResponse } from 'next/server';
import { createEnrollmentToken } from '@/lib/store';

// Admin issues an enrollment token for a role; a node uses it once to enroll.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const role = typeof body?.role === 'string' ? body.role : 'Field Advisor';
  return NextResponse.json(await createEnrollmentToken(role), { status: 201 });
}
