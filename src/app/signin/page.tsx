import { TerminalWindow as TerminalSquare } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import { signIn } from '@/auth';
import { devLoginEnabled, googleEnabled, microsoftEnabled } from '@/auth.config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function withGoogle(): Promise<void> {
  'use server';
  await signIn('google', { redirectTo: '/fleet' });
}

async function withMicrosoft(): Promise<void> {
  'use server';
  await signIn('microsoft-entra-id', { redirectTo: '/fleet' });
}

async function withDev(): Promise<void> {
  'use server';
  await signIn('dev', { redirectTo: '/fleet' });
}

export default function SignInPage() {
  const noProviders = !googleEnabled && !microsoftEnabled && !devLoginEnabled;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="items-center text-center">
          <Image src="/logo.png" alt="Off Grid" width={40} height={40} className="mb-2" priority />
          <CardTitle className="text-base">Off Grid Console</CardTitle>
          <CardDescription>Sign in to govern your fleet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {googleEnabled ? (
            <form action={withGoogle}>
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
          ) : null}
          {microsoftEnabled ? (
            <form action={withMicrosoft}>
              <Button type="submit" variant="outline" className="w-full">
                Continue with Microsoft
              </Button>
            </form>
          ) : null}
          {devLoginEnabled ? (
            <form action={withDev}>
              <Button type="submit" className="w-full">
                <TerminalSquare className="size-4" />
                Dev sign-in (admin)
              </Button>
            </form>
          ) : null}
          {noProviders ? (
            <p className="text-center text-xs text-muted-foreground">
              No SSO providers configured. Add Google or Microsoft credentials in .env.local.
            </p>
          ) : null}
          <p className="pt-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
            On-prem · SSO
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
