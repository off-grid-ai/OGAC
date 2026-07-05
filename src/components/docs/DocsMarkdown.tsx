'use client';

import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Markdown renderer for docs pages — brand-styled headings, links, code, lists, tables. Internal
// /docs links use next/link for client nav; external links open in a new tab.
export function DocsMarkdown({ body }: { body: string }) {
  return (
    <div className="max-w-none space-y-4 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="mt-8 border-b border-border pb-1.5 text-lg font-semibold text-foreground">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-6 text-base font-medium text-foreground">{children}</h3>
          ),
          p: ({ children }) => <p className="text-muted-foreground">{children}</p>,
          ul: ({ children }) => (
            <ul className="ml-5 list-disc space-y-1.5 text-muted-foreground marker:text-muted-foreground/50">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-5 list-decimal space-y-1.5 text-muted-foreground marker:text-muted-foreground/50">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
          a: ({ href, children }) => {
            const url = href ?? '#';
            if (url.startsWith('/')) {
              return (
                <Link href={url} className="text-primary underline-offset-4 hover:underline">
                  {children}
                </Link>
              );
            }
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                {children}
              </a>
            );
          },
          code: ({ children, className }) => {
            const inline = !className;
            if (inline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
                  {children}
                </code>
              );
            }
            return (
              <code className="block overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs text-foreground">
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
