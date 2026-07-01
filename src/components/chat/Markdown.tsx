'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
            return (
              <pre className="my-2 overflow-x-auto rounded-md border border-border bg-card p-3">
                {children}
              </pre>
            );
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
