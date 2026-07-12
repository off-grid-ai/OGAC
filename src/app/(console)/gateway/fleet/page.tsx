import {
  Cpu,
  DeviceMobile,
  LockKey,
  ShieldCheck,
  ArrowsClockwise,
  ClipboardText,
} from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { getMdm } from '@/lib/adapters/registry';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Fleet / device management is a ROADMAP surface — not yet live. This page is an honest
// "coming soon" (no live device data rendered as if operational). When the MDM control plane
// ships, this becomes the real list→detail management surface (inventory, enrollment, commands).
const UPCOMING: { icon: typeof Cpu; title: string; body: string }[] = [
  {
    icon: Cpu,
    title: 'Device inventory & health',
    body: 'Every device that touches your AI — OS, role, last-seen, and live health, read back from the MDM.',
  },
  {
    icon: DeviceMobile,
    title: 'Enrollment',
    body: 'One-command enrollment with signed tokens, so a device joins the estate under policy from first boot.',
  },
  {
    icon: LockKey,
    title: 'Remote lock & wipe',
    body: 'Lock or wipe a lost or compromised device on demand — and prove it happened in the audit trail.',
  },
  {
    icon: ArrowsClockwise,
    title: 'Configuration push',
    body: 'Push a config profile or setting to a device or a whole role group, and watch it converge.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance posture',
    body: 'CVE exposure, patch level, and policy compliance per device — the posture your auditors ask for.',
  },
  {
    icon: ClipboardText,
    title: 'Governed by the same policy',
    body: 'Device commands run through the same ABAC policy, approvals, and audit as everything else in the console.',
  },
];

export default async function FleetPage() {
  await requireModuleForUser('fleet');
  const mdm = getMdm().meta;

  return (
    <div className="w-full space-y-6">
      <Card className="border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Badge variant="secondary" className="mt-0.5 bg-primary/10 text-primary">
              Coming soon
            </Badge>
            <div className="max-w-2xl">
              <h2 className="text-sm font-semibold text-foreground">Device management</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Enroll, inventory, and govern every device that touches your AI — inventory and
                health first, then remote lock/wipe, config-profile push, and compliance posture. All
                under the same policy and audit as the rest of the console.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              MDM backend
            </span>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {mdm.vendor}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {UPCOMING.map((u) => (
          <Card key={u.title} className="shadow-sm">
            <CardContent className="space-y-2 py-5">
              <u.icon className="size-5 text-primary" />
              <h3 className="text-sm font-medium text-foreground">{u.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{u.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground/70">
        The MDM backend is swappable in Settings (native registry · FleetDM/osquery). Device
        inventory, enrollment, and commands light up here when the control plane ships.
      </p>
    </div>
  );
}
