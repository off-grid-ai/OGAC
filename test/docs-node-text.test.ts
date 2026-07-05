import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeText } from '@/lib/docs/node-text';

// The docs code-copy button relies on nodeText to recover the raw source after a syntax highlighter
// wraps code in nested elements. These cases mirror what rehype-highlight produces.

test('nodeText returns plain strings unchanged', () => {
  assert.equal(nodeText('curl https://x'), 'curl https://x');
});

test('nodeText joins arrays of strings', () => {
  assert.equal(nodeText(['a', 'b', 'c']), 'abc');
});

test('nodeText stringifies numbers and ignores null/boolean', () => {
  assert.equal(nodeText([1, null, 2, false, 3]), '123');
  assert.equal(nodeText(null), '');
  assert.equal(nodeText(undefined), '');
});

test('nodeText recurses through element children (highlighted spans)', () => {
  // Shape rehype-highlight yields: <code><span class="hljs-keyword">const</span> x = 1;</code>
  const tree = {
    props: {
      children: [
        { props: { children: 'const' } },
        ' x = 1;',
      ],
    },
  };
  assert.equal(nodeText(tree), 'const x = 1;');
});

test('nodeText handles deeply nested element trees', () => {
  const tree = {
    props: {
      children: [
        { props: { children: [{ props: { children: 'a' } }, 'b'] } },
        { props: { children: 'c' } },
      ],
    },
  };
  assert.equal(nodeText(tree), 'abc');
});
