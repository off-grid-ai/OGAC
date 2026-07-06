// Thin I/O adapter that gates a device DATA-PLANE request (/api/v1/devices/[id]/{audit,policy,
// commands}). The device data-plane is public in middleware because it authenticates with a
// per-device Bearer token, not user SSO — this is the seam that enforces it. All decision logic is
// the PURE verifyDeviceToken() (src/lib/device-token.ts); the only I/O here is reading the device's
// stored token. Returns a NextResponse (401/404) on rejection, or null when the request is authorized.
import { NextResponse } from 'next/server';
import { bearerFromHeader, verifyDeviceToken } from '@/lib/device-token';
import { getDevice, getDeviceToken } from '@/lib/store';

export async function gateDeviceRequest(req: Request, id: string): Promise<NextResponse | null> {
  const presented = bearerFromHeader(req.headers.get('authorization'));
  const stored = await getDeviceToken(id);
  // A device with no stored token (unknown id OR pre-hardening) can still authenticate via the
  // legacy dt_<id> form ONLY if the row exists — so verify first, then confirm existence, so an
  // unknown id can never be probed for command/policy contents.
  if (!verifyDeviceToken(id, presented, stored)) {
    return NextResponse.json({ error: 'invalid device token' }, { status: 401 });
  }
  if (!(await getDevice(id))) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  return null;
}
