import { Badge } from '@/components/ui/badge';
import { MODULE_ICONS } from '@/modules/icons';
import { MODULES, type ModuleId } from '@/modules/registry';

interface ModulePlaceholderProps {
  id: ModuleId;
  milestone?: string;
  note?: string;
}

export function ModulePlaceholder({ id, milestone, note }: Readonly<ModulePlaceholderProps>) {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) return null;
  const Icon = MODULE_ICONS[id];

  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-6" />
        </div>
        <h2 className="text-base font-medium text-foreground">{mod.label}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{note ?? mod.description}</p>
        {milestone ? (
          <Badge variant="secondary" className="mt-4">
            Planned · {milestone}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
