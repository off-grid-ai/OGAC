import { TerminalWindow as TerminalSquare } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import { signIn } from '@/auth';
import { devLoginEnabled, googleEnabled, keycloakEnabled, microsoftEnabled } from '@/auth.config';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Provider availability is read from env at request time — must not be baked in at build
// (a build without the SSO env would freeze this to "no method configured").
export const dynamic = 'force-dynamic';

async function withGoogle(): Promise<void> {
  'use server';
  await signIn('google', { redirectTo: '/fleet' });
}

async function withMicrosoft(): Promise<void> {
  'use server';
  await signIn('microsoft-entra-id', { redirectTo: '/fleet' });
}

async function withKeycloak(): Promise<void> {
  'use server';
  await signIn('keycloak', { redirectTo: '/fleet' });
}

async function withDev(): Promise<void> {
  'use server';
  await signIn('dev', { redirectTo: '/fleet' });
}

interface ProviderButton {
  enabled: boolean;
  action: () => Promise<void>;
  label: string;
  primary?: boolean;
  dev?: boolean;
}

const PROVIDERS: ProviderButton[] = [
  { enabled: googleEnabled, action: withGoogle, label: 'Continue with Google' },
  { enabled: microsoftEnabled, action: withMicrosoft, label: 'Continue with Microsoft' },
  { enabled: keycloakEnabled, action: withKeycloak, label: 'Continue with Keycloak' },
  {
    enabled: devLoginEnabled,
    action: withDev,
    label: 'Dev sign-in (admin)',
    primary: true,
    dev: true,
  },
];

export default function SignInPage() {
  const active = PROVIDERS.filter((p) => p.enabled);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="items-center text-center">
          <Image src="/logo.png" alt="Off Grid" width={40} height={40} className="mb-2" priority />
          <CardTitle className="text-base">Off Grid Console</CardTitle>
          <CardDescription>
            Sign in to your control plane — fleet, models, data, agents, and governance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {active.map((p) => (
            <form key={p.label} action={p.action}>
              <Button type="submit" variant={p.primary ? 'default' : 'outline'} className="w-full">
                {p.dev ? <TerminalSquare className="size-4" /> : null}
                {p.label}
              </Button>
            </form>
          ))}
          {active.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              No sign-in method configured. Add Keycloak, Google, or Microsoft credentials to the
              console environment.
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
