'use client';

// Inline artifact code editor (task #92). A plain monospace textarea over the artifact source;
// every keystroke lifts the buffer up so the parent viewer can live-re-render the preview. Kept as
// its own component so ArtifactView stays thin and the editor is independently reusable/testable.
// Pure presentation — no I/O, no persistence (the parent owns Save/Cancel and the persist route).

interface ArtifactEditorProps {
  value: string;
  onChange: (next: string) => void;
  // Cmd/Ctrl+S saves without leaving the editor; Escape cancels. Both are optional so the editor
  // works standalone; the viewer wires them to its Save/Cancel handlers.
  onSave?: () => void;
  onCancel?: () => void;
}

export function ArtifactEditor({ value, onChange, onSave, onCancel }: Readonly<ArtifactEditorProps>) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          onSave?.();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel?.();
        }
      }}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      aria-label="Edit artifact source"
      className="h-full w-full resize-none border-0 bg-background p-4 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
    />
  );
}
