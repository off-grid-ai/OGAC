import { createElement } from 'react';

// Node's ESM resolver cannot load Next's bundler-only image entrypoint. Preserve the observable
// image semantics for rendered integration tests; all Off Grid navigation code remains real.
export default function Image({ priority: _priority, ...props }) {
  return createElement('img', props);
}
