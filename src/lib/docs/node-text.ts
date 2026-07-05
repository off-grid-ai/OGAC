// Pure helper: recover the plain-text content of an arbitrary React node tree. Used by the docs
// code-copy button, which must yield the raw source even after a syntax highlighter has wrapped the
// code in nested <span> elements. Zero React-runtime dependency (only reads .props.children), so it
// is trivially unit-testable with plain objects.
import type { ReactNode } from 'react';

export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  // React element: descend into its children.
  const el = node as { props?: { children?: ReactNode } };
  if (el && typeof el === 'object' && el.props) return nodeText(el.props.children);
  return '';
}
