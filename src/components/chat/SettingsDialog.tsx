'use client';

import {
  Database as DatabaseIcon,
  Gear,
  PaintBrush,
  Sliders,
  User as UserIcon,
  UserCircle,
} from '@phosphor-icons/react/dist/ssr';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Comprehensive multi-section settings modal (ChatGPT/Claude parity): a left section list and a
// right pane. Custom instructions persist via /api/v1/chat/settings; capability toggles via
// /api/v1/chat/prefs; theme via next-themes; data actions via /api/v1/chat/data.
type Section = 'profile' | 'appearance' | 'personalization' | 'capabilities' | 'data' | 'account';

const SECTIONS: { id: Section; label: string; icon: typeof Gear }[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'appearance', label: 'Appearance', icon: PaintBrush },
  { id: 'personalization', label: 'Personalization', icon: Sliders },
  { id: 'capabilities', label: 'Capabilities', icon: Gear },
  { id: 'data', label: 'Data & privacy', icon: DatabaseIcon },
  { id: 'account', label: 'Account', icon: UserCircle },
];

interface Prefs {
  memory?: boolean;
  codeExecution?: boolean;
  search?: boolean;
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [section, setSection] = useState<Section>('profile');
  const [instructions, setInstructions] = useState('');
  const [prefs, setPrefs] = useState<Prefs>({ memory: true, codeExecution: true, search: true });

  useEffect(() => {
    if (!open) return;
    void fetch('/api/v1/chat/settings')
      .then((r) => (r.ok ? r.json() : { customInstructions: '' }))
      .then((d) => setInstructions(d.customInstructions ?? ''));
    void fetch('/api/v1/chat/prefs')
      .then((r) => (r.ok ? r.json() : { prefs: {} }))
      .then((d) => setPrefs({ memory: true, codeExecution: true, search: true, ...(d.prefs ?? {}) }));
  }, [open]);

  async function saveInstructions() {
    await fetch('/api/v1/chat/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customInstructions: instructions }),
    });
    toast.success('Custom instructions saved');
  }

  async function updatePref(key: keyof Prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await fetch('/api/v1/chat/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefs: next }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-3">
          <DialogTitle className="text-sm">Settings</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[26rem]">
          <nav className="w-48 shrink-0 space-y-0.5 border-r border-border p-2">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs',
                    section === s.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-3.5" /> {s.label}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto p-5">
            <SectionBody
              section={section}
              instructions={instructions}
              setInstructions={setInstructions}
              onSaveInstructions={saveInstructions}
              prefs={prefs}
              onUpdatePref={updatePref}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  section: Section;
  instructions: string;
  setInstructions: (v: string) => void;
  onSaveInstructions: () => void;
  prefs: Prefs;
  onUpdatePref: (key: keyof Prefs, value: boolean) => void;
}

// eslint-disable-next-line complexity
function SectionBody(p: BodyProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (p.section === 'profile') {
    return (
      <Field title="Profile" hint="How you appear across the console.">
        <p className="text-xs text-muted-foreground">
          Your profile is managed by your organization&apos;s identity provider. Sign-out and account
          removal live under Account.
        </p>
      </Field>
    );
  }

  if (p.section === 'appearance') {
    const dark = mounted && theme === 'dark';
    return (
      <Field title="Appearance" hint="Off Grid brutalist theme — mono type, emerald accent.">
        <Row label="Dark mode" desc="Toggle between the light and dark palette.">
          <Switch checked={dark} onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')} />
        </Row>
      </Field>
    );
  }

  if (p.section === 'personalization') {
    return (
      <Field
        title="Personalization"
        hint="Custom instructions applied to every chat as a system prompt."
      >
        <Textarea
          value={p.instructions}
          onChange={(e) => p.setInstructions(e.target.value)}
          rows={6}
          placeholder="e.g. Be concise. I'm an engineer — prefer code and bullet points over prose."
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={p.onSaveInstructions}>
            Save
          </Button>
        </div>
      </Field>
    );
  }

  if (p.section === 'capabilities') {
    return (
      <Field title="Capabilities" hint="Turn model abilities on or off for your chats.">
        <Row label="Memory" desc="Remember salient facts across conversations.">
          <Switch checked={!!p.prefs.memory} onCheckedChange={(v) => p.onUpdatePref('memory', v)} />
        </Row>
        <Row label="Code execution" desc="Run generated code in the console sandbox.">
          <Switch
            checked={!!p.prefs.codeExecution}
            onCheckedChange={(v) => p.onUpdatePref('codeExecution', v)}
          />
        </Row>
        <Row label="Search" desc="Retrieve from project knowledge to ground answers.">
          <Switch checked={!!p.prefs.search} onCheckedChange={(v) => p.onUpdatePref('search', v)} />
        </Row>
      </Field>
    );
  }

  if (p.section === 'data') {
    return <DataSection />;
  }

  return (
    <Field title="Account" hint="Session and access.">
      <p className="text-xs text-muted-foreground">
        You are signed in through your organization. Use the console top bar to sign out. Contact an
        admin to change roles or remove your account.
      </p>
    </Field>
  );
}

function DataSection() {
  async function deleteChats() {
    if (!confirm('Delete ALL of your chats? This cannot be undone.')) return;
    const r = await fetch('/api/v1/chat/data', { method: 'DELETE' });
    if (r.ok) toast.success('All chats deleted');
    else toast.error('Delete failed');
  }
  return (
    <Field title="Data & privacy" hint="Your chat data stays on your org's on-prem gateways.">
      <Row label="Export my data" desc="Download all chats, projects, memory, and settings as JSON.">
        <Button asChild size="sm" variant="outline">
          <a href="/api/v1/chat/data" download>
            Export
          </a>
        </Button>
      </Row>
      <Row label="Delete my chats" desc="Permanently remove every conversation and message.">
        <Button size="sm" variant="destructive" onClick={deleteChats}>
          Delete
        </Button>
      </Row>
      <p className="pt-1 text-[11px] text-muted-foreground">
        Retention: chats persist until you delete them — nothing is auto-expired, and nothing leaves
        your deployment.
      </p>
    </Field>
  );
}

function Field({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div className="space-y-0.5">
        <Label className="text-xs">{label}</Label>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}
