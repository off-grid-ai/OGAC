// Docs content types — shared by every section file. A page is markdown; sections group pages in
// the sidebar. Copy follows brand/ (outcomes-first, Off Grid voice, no em dashes / AI-slop).
export interface DocPage {
  slug: string; // path under /docs ('' = home). e.g. 'guides/chat'
  title: string;
  description: string; // one line
  body: string; // markdown
}
export interface DocSection {
  id: string;
  label: string;
  pages: DocPage[];
}
