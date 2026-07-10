import { TerminalWindow as TerminalSquare } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { devLoginEnabled, googleEnabled, microsoftEnabled, passwordEnabled } from '@/auth.config';
import { BookCallDialog } from '@/components/auth/BookCallDialog';
import { WriteToUsDialog } from '@/components/auth/WriteToUsDialog';
import { PasswordField } from '@/components/auth/PasswordField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { readSigninDemoBanner } from '@/lib/demo-hellobar';
import { tenantSlugFromHost } from '@/lib/route-access';
import { SigninDemoBanner } from './SigninDemoBanner';
import { SigninHeader } from './SigninHeader';

// Provider availability is read from env at request time (not baked at build).
export const dynamic = 'force-dynamic';

// Where to land after a successful sign-in. The Caddy gate forwards the originally
// requested URL as `callbackUrl` so a user gated out of console-status returns THERE,
// not to /fleet. Only same-suite targets are honored (relative path, or an https URL
// on *.getoffgridai.co) — anything else falls back to /fleet, so the param can't be
// used as an open redirect.
// eslint-disable-next-line complexity
function safeCallback(raw: FormDataEntryValue | null): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '/gateway/fleet';
  if (v.startsWith('/') && !v.startsWith('//')) return v; // relative, same-origin
  try {
    const u = new URL(v);
    if (
      u.protocol === 'https:' &&
      (u.hostname === 'getoffgridai.co' || u.hostname.endsWith('.getoffgridai.co'))
    ) {
      return u.toString();
    }
  } catch {
    /* not a URL — fall through */
  }
  return '/gateway/fleet';
}

// Owned login: the console authenticates username/password through the identity seam
// (Keycloak ROPC server-side) — the browser never leaves the console, no hosted IdP
// page, no internal IP leak. SSO buttons appear only when explicitly configured.
async function withPassword(formData: FormData): Promise<void> {
  'use server';
  const redirectTo = safeCallback(formData.get('callbackUrl'));
  try {
    await signIn('password', {
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirectTo,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      redirect(
        `/signin?error=1&callbackUrl=${encodeURIComponent(String(formData.get('callbackUrl') ?? ''))}`,
      );
    }
    throw e; // success path throws NEXT_REDIRECT — must propagate
  }
}
async function withGoogle(formData: FormData): Promise<void> {
  'use server';
  await signIn('google', { redirectTo: safeCallback(formData.get('callbackUrl')) });
}
async function withMicrosoft(formData: FormData): Promise<void> {
  'use server';
  await signIn('microsoft-entra-id', { redirectTo: safeCallback(formData.get('callbackUrl')) });
}
async function withDev(formData: FormData): Promise<void> {
  'use server';
  await signIn('dev', { redirectTo: safeCallback(formData.get('callbackUrl')) });
}

// eslint-disable-next-line complexity
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const sso = [
    { enabled: googleEnabled, action: withGoogle, label: 'Continue with Google' },
    { enabled: microsoftEnabled, action: withMicrosoft, label: 'Continue with Microsoft' },
  ].filter((p) => p.enabled);

  // The demo-credentials banner is decided server-side: the request host (trusted, set by Cloudflare)
  // gives the demo tenant SLUG, which picks that tenant's own read-only viewer creds from env. The
  // visitor is logged out at signin, so this is host-gated (not role-gated like the authed hellobar).
  const host = (await headers()).get('host');
  const demoBanner = readSigninDemoBanner(tenantSlugFromHost(host));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SigninHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        {demoBanner.show ? (
          <div className="w-full max-w-sm">
            <SigninDemoBanner model={demoBanner} />
          </div>
        ) : null}
        <Card className="w-full max-w-sm shadow-sm">
          <CardHeader className="items-center text-center">
            <Image
              src="/logo.png"
              alt="Off Grid AI"
              width={40}
              height={40}
              className="mb-2"
              priority
            />
            <CardTitle className="text-base">Off Grid AI Console</CardTitle>
            <CardDescription>
              Sign in to your control plane: fleet, models, data, agents, and governance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
                Incorrect email or password.
              </p>
            ) : null}

            {passwordEnabled ? (
              <form action={withPassword} className="space-y-2.5">
                {callbackUrl ? (
                  <input type="hidden" name="callbackUrl" value={callbackUrl} />
                ) : null}
                <Input
                  name="username"
                  type="text"
                  placeholder="Email"
                  autoComplete="username"
                  required
                  className="font-mono text-sm"
                />
                <PasswordField />
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            ) : null}

            {sso.length ? (
              <>
                {passwordEnabled ? (
                  <div className="py-1 text-center">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      or
                    </span>
                  </div>
                ) : null}
                {sso.map((p) => (
                  <form key={p.label} action={p.action}>
                    {callbackUrl ? (
                      <input type="hidden" name="callbackUrl" value={callbackUrl} />
                    ) : null}
                    <Button type="submit" variant="outline" className="w-full">
                      {p.label}
                    </Button>
                  </form>
                ))}
              </>
            ) : null}

            {devLoginEnabled ? (
              <form action={withDev}>
                {callbackUrl ? (
                  <input type="hidden" name="callbackUrl" value={callbackUrl} />
                ) : null}
                <Button type="submit" variant="ghost" className="w-full text-muted-foreground">
                  <TerminalSquare className="size-4" />
                  Dev sign-in (admin)
                </Button>
              </form>
            ) : null}

            {!passwordEnabled && sso.length === 0 && !devLoginEnabled ? (
              <p className="text-center text-xs text-muted-foreground">
                No sign-in method configured. Set the identity backend in the console environment.
              </p>
            ) : null}

            {/* No account yet → route to sales. Book a call opens Mac's cal.com; "Write to us" is a
              request-access form that posts to /api/waitlist → the same Google Sheet as the marketing
              waitlist. Both are dialogs (no third-party script / mailto), keeping the auth-page CSP tight. */}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-center text-xs text-muted-foreground">
                Don&apos;t have an account?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <BookCallDialog />
                <WriteToUsDialog />
              </div>
            </div>

            <p className="pt-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              On-prem · Secure
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
