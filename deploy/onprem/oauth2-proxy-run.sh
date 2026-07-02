#!/bin/bash
export PATH=/usr/local/bin:/usr/bin:/bin
exec /Users/admin/oauth2-proxy \
  --provider=oidc \
  --oidc-issuer-url=http://127.0.0.1:8080/realms/offgrid \
  --client-id=oauth2-proxy \
  --client-secret="$(cat /Users/admin/.oauth2proxy_secret)" \
  --cookie-secret="$(cat /Users/admin/.oauth2proxy_cookie)" \
  --cookie-domain=.getoffgridai.co \
  --cookie-secure=true \
  --whitelist-domain=.getoffgridai.co \
  --email-domain=* \
  --reverse-proxy=true \
  --set-xauthrequest=true \
  --skip-provider-button=true \
  --upstream=static://200 \
  --http-address=127.0.0.1:4180 \
  --redirect-url=https://console-status.getoffgridai.co/oauth2/callback
