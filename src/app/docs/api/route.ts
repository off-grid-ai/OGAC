import { ApiReference } from '@scalar/nextjs-api-reference';

// Interactive OpenAPI reference (Scalar) — the API section of the docs, at /docs/api.
export const GET = ApiReference({
  url: '/openapi.json',
  theme: 'default',
});
