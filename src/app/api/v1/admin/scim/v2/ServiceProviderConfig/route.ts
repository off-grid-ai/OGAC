import { NextResponse } from 'next/server';
import { SCIM_CONTENT } from '../../auth';

// SCIM 2.0 ServiceProviderConfig (RFC 7643 §5) — advertises supported capabilities to the IdP.
export const dynamic = 'force-dynamic';

export function GET() {
  return new NextResponse(
    JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://getoffgridai.co/docs/scim',
      patch: { supported: false },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: false, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'Static bearer token (OFFGRID_SCIM_TOKEN).',
          primary: true,
        },
      ],
    }),
    { headers: { 'content-type': SCIM_CONTENT } },
  );
}
