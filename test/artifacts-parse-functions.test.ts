import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSrcDoc, isLiveKind, parseArtifact } from '@/lib/artifacts';

// Pure artifact detection + iframe srcDoc assembly (ported from the Desktop ArtifactCanvas parser).
// Zero I/O — real fenced-code / markup inputs, real assertions. Covers the detection ladder and the
// live-render srcDoc branches (which also exercise the internal escapeHtml + stripImportsExports).

test('isLiveKind: html/svg/react/mermaid render live; text/code do not', () => {
  for (const k of ['html', 'svg', 'react', 'mermaid']) assert.equal(isLiveKind(k), true);
  for (const k of ['text', 'code', 'unknown']) assert.equal(isLiveKind(k), false);
});

test('parseArtifact: a fenced react/jsx block → react artifact', () => {
  const md = 'Here you go:\n```jsx\nexport default function App(){ return <div>hi</div> }\n```';
  const a = parseArtifact(md);
  assert.equal(a?.kind, 'react');
  assert.ok(a!.code.includes('function App'));
});

test('parseArtifact: an html fenced block → html artifact (trimmed)', () => {
  const a = parseArtifact('```html\n<h1>Hi</h1>\n```');
  assert.equal(a?.kind, 'html');
  assert.equal(a?.code, '<h1>Hi</h1>');
});

test('parseArtifact: a plain js block that LOOKS like React is detected as react', () => {
  const a = parseArtifact('```js\nconst x = () => (<div className="a">y</div>);\n```');
  assert.equal(a?.kind, 'react');
});

test('parseArtifact: a bare <svg> with no fence → svg artifact', () => {
  const a = parseArtifact('some text <svg width="10"><rect/></svg> trailing');
  assert.equal(a?.kind, 'svg');
  assert.ok(a!.code.startsWith('<svg'));
});

test('parseArtifact: a python block → runnable code artifact tagged python', () => {
  const a = parseArtifact('```python\nprint("hi")\n```');
  assert.equal(a?.kind, 'code');
  assert.equal(a?.language, 'python');
});

test('parseArtifact: a non-React js block → runnable node code artifact', () => {
  const a = parseArtifact('```js\nconsole.log(1 + 1)\n```');
  assert.equal(a?.kind, 'code');
  assert.equal(a?.language, 'node');
});

test('parseArtifact: prose with no renderable block → null', () => {
  assert.equal(parseArtifact('just a normal sentence with no code.'), null);
});

test('buildSrcDoc: html passes through verbatim by default', () => {
  const doc = buildSrcDoc({ kind: 'html', code: '<h1>x</h1>' });
  assert.equal(doc, '<h1>x</h1>');
});

test('buildSrcDoc: svg is centered on a dark canvas', () => {
  const doc = buildSrcDoc({ kind: 'svg', code: '<svg></svg>' });
  assert.ok(doc.includes('place-items:center'));
  assert.ok(doc.includes('<svg></svg>'));
});

test('buildSrcDoc: mermaid escapes the source and loads mermaid from the CDN', () => {
  const doc = buildSrcDoc({ kind: 'mermaid', code: 'graph TD; A-->B & C' });
  // escapeHtml turns & into &amp; inside the <pre class="mermaid"> block.
  assert.ok(doc.includes('&amp;'), 'ampersand should be HTML-escaped');
  assert.ok(doc.includes('mermaid@11'));
});

test('buildSrcDoc: react strips import/export syntax and bootstraps React/Babel', () => {
  const doc = buildSrcDoc({
    kind: 'react',
    code: "import React from 'react';\nexport default function App(){ return null }",
  });
  assert.ok(doc.includes('@babel/standalone'));
  // The import line is stripped and `export default function App` → `function App`.
  assert.ok(!doc.includes("import React from 'react'"));
  assert.ok(doc.includes('function App'));
  assert.ok(!doc.includes('export default function App'));
});

test('buildSrcDoc: the bridge injects the window.offgrid.complete proxy and honors a custom cdn', () => {
  const doc = buildSrcDoc(
    { kind: 'react', code: 'export default function App(){return null}' },
    { bridge: true, cdn: 'https://example.test/cdn' },
  );
  assert.ok(doc.includes('window.offgrid'));
  assert.ok(doc.includes('https://example.test/cdn/npm/react@18'));
});
