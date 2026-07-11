'use client';

import { Check, Copy } from '@phosphor-icons/react/dist/ssr';
import { Fragment, type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseCitationMarkers } from '@/lib/chat-citations';
import { stripControlTokens } from '@/lib/strip-control-tokens';

// Recursively pull plain text out of a React node tree (for the code-block copy button).
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in node) return nodeText((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function CodeBlock({ children }: Readonly<{ children: ReactNode }>) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(nodeText(children)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group/code relative my-2">
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-border bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
        title="Copy code"
      >
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto rounded-md border border-border bg-card p-3">{children}</pre>
    </div>
  );
}

// Inline citation chip: a small superscript [n] the reader clicks to jump to source n in the
// footer. On-brand — mono, emerald, minimal radius. Purely a transform target; when the answer has
// no sources the caller never wires onCiteClick so no chips render.
function CiteChip({ n, onClick }: Readonly<{ n: number; onClick: (n: number) => void }>) {
  return (
    <sup>
      <button
        type="button"
        onClick={() => onClick(n)}
        title={`Jump to source ${n}`}
        className="mx-0.5 inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[0.65em] font-medium leading-none text-primary transition-colors duration-150 hover:bg-primary/20"
      >
        {n}
      </button>
    </sup>
  );
}

// Walk react-markdown's rendered children and swap bracketed citation markers ([1], [1,2]) inside
// string runs for clickable CiteChips, keying validity to sourceCount so dangling markers ([9] when
// there are 3 sources) stay literal text. Non-string children (already-styled <em>, <code>, links)
// pass through untouched. Pure over its inputs — the chip's only side effect is the click handler.
function linkifyCitations(
  children: ReactNode,
  sourceCount: number,
  onCiteClick: (n: number) => void,
): ReactNode {
  if (typeof children === 'string') {
    const segs = parseCitationMarkers(children, sourceCount);
    // No valid markers → return the original string unchanged (avoids needless fragment wrapping).
    if (!segs.some((s) => s.type === 'cite' && s.valid)) return children;
    return segs.map((s, i) =>
      s.type === 'text' ? (
        <Fragment key={i}>{s.text}</Fragment>
      ) : s.valid ? (
        <CiteChip key={i} n={s.n} onClick={onCiteClick} />
      ) : (
        // Dangling marker: keep the literal text so we never hide what the model wrote.
        <Fragment key={i}>[{s.n}]</Fragment>
      ),
    );
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <Fragment key={i}>{linkifyCitations(c, sourceCount, onCiteClick)}</Fragment>
    ));
  }
  return children;
}

// Markdown renderer for assistant replies — GFM tables/lists, styled code blocks, in the
// console's mono/emerald look. Deliberately dependency-light (no syntax highlighter).
// When `sourceCount`>0 and `onCiteClick` is provided, inline [n] markers become clickable citation
// chips that jump to the Sources footer. Omit them and rendering is unchanged (clean degradation).
export function Markdown({
  children,
  sourceCount = 0,
  onCiteClick,
}: Readonly<{
  children: string;
  sourceCount?: number;
  onCiteClick?: (n: number) => void;
}>) {
  // Strip inline model control/tool tokens (`<function=…>`, `<think>…</think>`, `<tool_call>…`,
  // `<|im_start|>`) before rendering so a leaked token never appears as visible text nor a private
  // chain-of-thought bleeds into the bubble. Same rule TTS uses (single source of truth).
  const safe = stripControlTokens(children);
  // Only linkify when we actually have somewhere for chips to point.
  const cite = (nodes: ReactNode): ReactNode =>
    sourceCount > 0 && onCiteClick ? linkifyCitations(nodes, sourceCount, onCiteClick) : nodes;
  return (
    <div className="prose-chat max-w-none text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const inline = !className;
            if (inline) {
              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`font-mono text-xs ${className ?? ''}`} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <CodeBlock>{children}</CodeBlock>;
          },
          a({ children, ...props }) {
            return (
              <a className="text-primary underline underline-offset-2" {...props}>
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="my-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return <th className="border border-border px-2 py-1 text-left font-medium">{cite(children)}</th>;
          },
          td({ children }) {
            return <td className="border border-border px-2 py-1">{cite(children)}</td>;
          },
          ul({ children }) {
            return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
          },
          li({ children }) {
            return <li>{cite(children)}</li>;
          },
          p({ children }) {
            return <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{cite(children)}</p>;
          },
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}
