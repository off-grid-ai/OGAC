import { NextResponse } from 'next/server';

// Waitlist / "write to us" capture from the signin page (public, no auth — the signin page is
// unauthenticated). Forwards each signup to WAITLIST_WEBHOOK_URL (the same Google Apps Script /
// Sheet the marketing site uses), so there is no DB to provision. Accepts the signup even if the
// webhook hiccups, so the form never errors for a visitor.
export const dynamic = 'force-dynamic';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown; name?: unknown; company?: unknown; message?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  const entry = {
    email,
    name: typeof body?.name === 'string' ? body.name.trim() : '',
    company: typeof body?.company === 'string' ? body.company.trim() : '',
    message: typeof body?.message === 'string' ? body.message.trim() : '',
    at: new Date().toISOString(),
    source: 'console-signin',
  };
  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry), redirect: 'manual', signal: AbortSignal.timeout(8000) });
    } catch (e) {
      console.error('waitlist webhook error:', e instanceof Error ? e.message : e);
    }
  } else {
    console.log('waitlist signup (no WAITLIST_WEBHOOK_URL set):', entry);
  }
  return NextResponse.json({ ok: true });
}
