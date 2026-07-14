'use client';

import {
  ArrowDown,
  ArrowUp,
  Plus,
  TextAa,
  Trash,
} from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { FormField } from '@/lib/app-model';

// ─── AppInputFieldsEditor (Builder Epic input-form work) — define an app's RUN INPUTS ──────────────
//
// A non-technical builder uses this to say WHAT a run needs: the typed fields the person filling in
// the form will see. It emits the app's inputForm (FormField[]) via onChange; the AppBuilder threads
// it into the spec and persists it on save (the create/patch API already accepts inputForm).
//
// PURE presentation: no fetch, no local model — it renders `fields` and calls onChange with the next
// array. All mutation is a plain array transform inline (add/remove/reorder/patch a field). Design
// system throughout (Card/Input/Label/Button/Switch, emerald accent, Menlo) and full-width.

const TYPE_OPTIONS: { value: FormField['type']; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Choice' },
  { value: 'date', label: 'Date' },
  { value: 'file', label: 'File / reference' },
];

// Turn a label into a stable-ish key when the user hasn't set one (snake_case, alnum only).
function keyFromLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  );
}

export function AppInputFieldsEditor({
  fields,
  onChange,
}: Readonly<{
  fields: FormField[];
  onChange: (next: FormField[]) => void;
}>) {
  function patch(index: number, patchFields: Partial<FormField>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patchFields } : f)));
  }
  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  function add() {
    const key = `field_${fields.length + 1}`;
    onChange([...fields, { key, label: '', type: 'text' }]);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TextAa className="size-4 text-primary" />
          Run inputs
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Define what a person fills in before running this app. Each field becomes a labelled,
          typed box on the run form — with help text, a placeholder, and an optional default.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            No inputs yet. Add a field for each thing this app needs from the person running it.
          </p>
        ) : (
          fields.map((f, i) => (
            <FieldEditorRow
              key={i}
              field={f}
              index={i}
              total={fields.length}
              onPatch={(p) => patch(i, p)}
              onRemove={() => remove(i)}
              onMove={(dir) => move(i, dir)}
            />
          ))
        )}
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={add}>
          <Plus className="size-3.5" />
          Add a field
        </Button>
      </CardContent>
    </Card>
  );
}

function FieldEditorRow({
  field,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
}: Readonly<{
  field: FormField;
  index: number;
  total: number;
  onPatch: (p: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}>) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Label</Label>
          <Input
            value={field.label}
            placeholder="e.g. Invoice amount"
            onChange={(e) => {
              const label = e.target.value;
              // Keep an unset/auto key in sync with the label until the user edits the key itself.
              const autoKey = !field.key || field.key.startsWith('field_');
              onPatch(autoKey ? { label, key: keyFromLabel(label) } : { label });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Key (used in the run payload)</Label>
          <Input
            value={field.key}
            placeholder="invoice_amount"
            onChange={(e) => onPatch({ key: e.target.value })}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Type</Label>
          <select
            value={field.type}
            onChange={(e) => onPatch({ type: e.target.value as FormField['type'] })}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {field.type === 'select' ? (
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">
            Choices (one per line)
          </Label>
          <Textarea
            value={(field.options ?? []).join('\n')}
            rows={3}
            placeholder={'Approve\nReject\nEscalate'}
            className="text-sm"
            onChange={(e) =>
              onPatch({
                options: e.target.value
                  .split('\n')
                  .map((o) => o.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Help text (optional)</Label>
          <Input
            value={field.description ?? ''}
            placeholder="Shown under the label to guide the person"
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Placeholder (optional)</Label>
          <Input
            value={field.placeholder ?? ''}
            placeholder="Ghost text inside the empty box"
            onChange={(e) => onPatch({ placeholder: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={!!field.required}
              onCheckedChange={(v) => onPatch({ required: v })}
            />
            Required
          </label>
          {field.type !== 'select' && field.type !== 'file' ? (
            <div className="flex items-center gap-2">
              <Label className="text-[11px] text-muted-foreground">Default</Label>
              <Input
                value={field.default ?? ''}
                placeholder="optional"
                onChange={(e) => onPatch({ default: e.target.value || undefined })}
                className="h-7 w-40 text-xs"
              />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === 0}
            aria-label="Move field up"
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === total - 1}
            aria-label="Move field down"
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            aria-label="Remove field"
            onClick={onRemove}
          >
            <Trash className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
