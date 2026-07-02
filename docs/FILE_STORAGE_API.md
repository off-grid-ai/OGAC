# Off Grid — File Storage API

Upload files, retrieve them, and toggle public/private. Files are stored **on-prem**
(local disk on the server; metadata in Postgres) — nothing leaves your infrastructure.

- **Base URL:** `https://gateway.getoffgridai.co`
- **Auth (write/list/manage):** the unified **key flow** — a Keycloak **service-account
  JWT** as `Authorization: Bearer <jwt>` (the same key model as the gateway). A console
  login session (cookie) also works for humans.
- **Public reads:** no auth. Private reads: require the Bearer key (else `404`).

### Getting a key (service account)
Keycloak issues machine keys — we don't run a custom key store. Create a service-account
client (Console → **Access → Machine Clients**, or reuse an existing one), then exchange
its `client_id`/`client_secret` for a short-lived JWT:
```bash
API_KEY=$(curl -s https://<keycloak>/realms/offgrid/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=<your-client> -d client_secret=<secret> \
  | jq -r .access_token)
```
Re-mint when it expires (~5 min). To manage files owned by others / act as admin, give
the service account the `admin` realm role in Keycloak; otherwise it manages its own.

> Private files return **404** (not 403) to callers without access, so their existence
> isn't revealed.

---

## Upload — `POST /api/v1/files`

Query: `?visibility=public|private` (default `private`). Two body styles:

**Raw bytes** (set the filename + type via headers):
```bash
curl -X POST "https://gateway.getoffgridai.co/api/v1/files?visibility=private" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Filename: report.pdf" \
  -H "Content-Type: application/pdf" \
  --data-binary @report.pdf
```

**Multipart form** (field name `file`):
```bash
curl -X POST "https://gateway.getoffgridai.co/api/v1/files?visibility=public" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@photo.jpg"
```

`201` response:
```json
{
  "id": "26d64a9b-c238-4446-8923-094ab3f090c8",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 20481,
  "visibility": "private",
  "owner": "you@company.com",
  "createdAt": "2026-07-02T…Z",
  "url": "https://gateway.getoffgridai.co/api/v1/files/26d64a9b-…"
}
```

## Retrieve — `GET /api/v1/files/{id}`

Returns the raw bytes with the original `Content-Type` and filename.
- **Public** file → works with no auth (the `url` above is shareable).
- **Private** file → send `Authorization: Bearer $API_KEY` (owner/admin only), else `404`.

```bash
# public
curl https://gateway.getoffgridai.co/api/v1/files/$ID -o out.pdf
# private
curl -H "Authorization: Bearer $API_KEY" https://gateway.getoffgridai.co/api/v1/files/$ID -o out.pdf
```

Metadata only (JSON, no bytes): `GET /api/v1/files/{id}?meta=1`.

## Make public / private — `PATCH /api/v1/files/{id}`

```bash
curl -X PATCH https://gateway.getoffgridai.co/api/v1/files/$ID \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"visibility":"public"}'      # or "private"
```
Returns the updated metadata. Owner or admin only.

## List your files — `GET /api/v1/files`

```bash
curl -H "Authorization: Bearer $API_KEY" https://gateway.getoffgridai.co/api/v1/files
# → { "files": [ { id, name, mime, size, visibility, url, … }, … ] }
```

## Delete — `DELETE /api/v1/files/{id}`

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  https://gateway.getoffgridai.co/api/v1/files/$ID
# → { "deleted": true }
```

---

## Status codes
| Code | Meaning |
|------|---------|
| 201  | Uploaded |
| 200  | OK (retrieve / patch / list / delete) |
| 400  | Empty body / missing `file` field |
| 401  | Missing/invalid credentials on a write/list call |
| 404  | Not found, or a private file without access |

## Notes / limits
- Storage: server local disk (`OFFGRID_FILES_DIR`) + Postgres metadata. Fully on-prem.
- Auth is the **one key flow** used across Off Grid: Keycloak service-account JWTs,
  validated through a single `IdentityVerifier` seam (`src/lib/auth/token-verifier.ts`)
  shared by the Files API, the admin API, and the gateway. Add a new IdP by implementing
  that interface — no endpoint changes.
- `OFFGRID_ADMIN_TOKEN` still works as an explicit **break-glass** static token if set
  (bootstrap/CI), but the canonical path is a Keycloak-issued key.
- Served through the **network gateway** (`gateway.getoffgridai.co`), so file requests
  get the edge WAF + rate limit. The console host (`onprem-console.getoffgridai.co`)
  also serves the same API directly if you prefer.
