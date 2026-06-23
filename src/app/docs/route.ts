import { ApiReference } from '@scalar/nextjs-api-reference';

// Interactive API playground (Scalar) rendered against the OpenAPI spec. Served at /docs.
export const GET = ApiReference({
  url: '/openapi.json',
  theme: 'default',
});
