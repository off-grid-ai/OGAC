import { createElement } from 'react';

// Native anchor behavior is the user-visible contract under test (deep link + browser history).
// Next's client prefetch layer is a framework boundary unavailable to node --test.
export default function Link({ children, ...props }) {
  return createElement('a', props, children);
}
