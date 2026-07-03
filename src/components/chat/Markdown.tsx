'use client';

import { Check, Copy } from '@phosphor-icons/react/dist/ssr';
import { type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Recursively pull plain text out of a React node tree (for the code-block copy button).
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in node) return nodeText((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

function CodeBlock({ children }: { children: ReactNode }) {
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

// Markdown renderer for assistant replies — GFM tables/lists, styled code blocks, in the
// console's mono/emerald look. Deliberately dependency-light (no syntax highlighter).
export function Markdown({ children }: { children: string }) {
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
            return <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>;
          },
          td({ children }) {
            return <td className="border border-border px-2 py-1">{children}</td>;
          },
          ul({ children }) {
            return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
          },
          p({ children }) {
            return <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
