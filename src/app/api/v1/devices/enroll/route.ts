import { NextResponse } from 'next/server';
import { type DeviceOS, enrollDevice } from '@/lib/store';

// A node registers with an admin-issued enrollment token; the console issues its identity.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = body?.token as string | undefined;
  const name = body?.name as string | undefined;
  const os = body?.os as DeviceOS | undefined;
  if (!token || !name || !os) {
    return NextResponse.json({ error: 'token, name, os are required' }, { status: 400 });
  }
  const device = await enrollDevice(token, name, os);
  if (!device) {
    return NextResponse.json({ error: 'invalid or already-used token' }, { status: 401 });
  }
  return NextResponse.json({ device, deviceToken: `dt_${device.id}` }, { status: 201 });
}
