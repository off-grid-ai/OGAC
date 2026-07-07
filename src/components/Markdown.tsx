import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Off Grid AI-branded markdown rendering for the hosted handbook. Maps each element to brand
// classes (Menlo via global font, emerald links, flat surfaces) so docs match the app.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-4 text-xl font-semibold tracking-tight text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 mb-3 border-b border-border pb-1 text-base font-medium text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-sm font-medium text-foreground">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-3 ml-5 list-disc space-y-1 text-sm text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 ml-5 list-decimal space-y-1 text-sm text-muted-foreground">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-md border border-border bg-muted p-3 text-[13px] leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-primary/50 pl-4 text-sm text-muted-foreground">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-3 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-1.5 align-top text-muted-foreground">{children}</td>
  ),
  hr: () => <hr className="my-8 border-border" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
