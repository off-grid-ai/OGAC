'use client';

import {
  BookOpenText,
  ChatCircleDots,
  File,
  MagnifyingGlass,
  SquaresFour,
  TextAlignLeft,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchResult {
  kind: 'module' | 'conversation' | 'prompt' | 'file';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const KIND_ICON: Record<SearchResult['kind'], React.ReactNode> = {
  module: <SquaresFour className="size-3.5" />,
  conversation: <ChatCircleDots className="size-3.5" />,
  prompt: <TextAlignLeft className="size-3.5" />,
  file: <File className="size-3.5" />,
};

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  module: 'Page',
  conversation: 'Chat',
  prompt: 'Prompt',
  file: 'File',
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`);
      if (r.ok) setResults(((await r.json()) as { results: SearchResult[] }).results);
    } finally { setLoading(false); }
  }, []);

  const onChange = (q: string) => {
    setQuery(q);
    setActive(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(q), 200);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) go(results[active].href);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, chats, prompts, files…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {loading && <span className="text-xs text-muted-foreground">…</span>}
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.id}`}>
                <button
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === active ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                  onClick={() => go(r.href)}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {KIND_ICON[r.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
                    {r.subtitle && (
                      <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                    )}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {KIND_LABEL[r.kind]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.length >= 2 && !loading && results.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No results for "{query}"</p>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 font-mono text-[10px] text-muted-foreground">
          <span><kbd className="rounded border border-border px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-border px-1">↵</kbd> open</span>
          <span><kbd className="rounded border border-border px-1">esc</kbd> close</span>
          <span className="ml-auto"><kbd className="rounded border border-border px-1">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
