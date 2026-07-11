'use client';

import { Check, Copy } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { slugifyHeading } from '@/lib/docs';
import { nodeText } from '@/lib/docs/node-text';

// The copy button needs the raw code text, but after syntax highlighting the code block's children
// are nested <span class="hljs-*"> elements, not a flat string. Recurse through the React tree to
// recover the plain text.
function headingText(children: React.ReactNode): string {
  return nodeText(children);
}

// A fenced code block with a copy button (docs are terminal/mono; the copy affordance is the key
// finesse for API samples).
function CodeBlock({
  children,
  className,
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  const [copied, setCopied] = useState(false);
  const text = headingText(children);
  // rehype-highlight adds `hljs language-*` to the <code> className; keep it so the highlight.js
  // theme (imported in globals.css) styles the nested spans.
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy code"
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-background/80 p-1.5 text-muted-foreground opacity-0 transition-all duration-150 hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
      </button>
      <code
        className={`block overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs text-foreground${
          className ? ` ${className}` : ''
        }`}
      >
        {children}
      </code>
    </div>
  );
}

// react-markdown's element-renderer map. Hoisted to module scope (not defined inside DocsMarkdown)
// so these renderers aren't re-created as nested components each render — they close over nothing
// from the component, only module-scope helpers. Render output is identical to the previous inline map.
const DOCS_COMPONENTS: Parameters<typeof ReactMarkdown>[0]['components'] = {
  h2: ({ children }) => (
    <h2
      id={slugifyHeading(headingText(children))}
      className="mt-8 scroll-mt-20 border-b border-border pb-1.5 text-lg font-semibold text-foreground"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={slugifyHeading(headingText(children))}
      className="mt-6 scroll-mt-20 text-base font-medium text-foreground"
    >
      {children}
    </h3>
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
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-4 hover:underline"
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => (
    // Screenshots on capability guides. Bordered/rounded to read as a framed screenshot,
    // responsive, with the alt as a caption. Plain <img> (not next/image) keeps /docs a
    // clean static export.
    <span className="mt-4 block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={typeof src === 'string' ? src : ''}
        alt={alt ?? ''}
        loading="lazy"
        className="w-full rounded-lg border border-border shadow-sm"
      />
      {alt ? (
        <span className="mt-1.5 block text-center text-xs text-muted-foreground">{alt}</span>
      ) : null}
    </span>
  ),
  code: ({ children, className }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  pre: ({ children }) => <>{children}</>,
};

// Markdown renderer for docs pages — brand-styled headings, links, code, lists, tables. Internal
// /docs links use next/link for client nav; external links open in a new tab. Headings get slug ids
// so the on-page table of contents can anchor to them.
export function DocsMarkdown({ body }: Readonly<{ body: string }>) {
  return (
    <div className="max-w-none space-y-4 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={DOCS_COMPONENTS}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
