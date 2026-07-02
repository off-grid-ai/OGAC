# Off Grid — File Storage API

Upload files, retrieve them, and toggle public/private. Files are stored **on-prem**
(local disk on the server; metadata in Postgres) — nothing leaves your infrastructure.

- **Base URL:** `https://onprem-console.getoffgridai.co`
- **Auth (write/list/manage):** `Authorization: Bearer <API_KEY>` — currently the console
  admin token (`OFFGRID_ADMIN_TOKEN`). A console login session (cookie) also works.
- **Public reads:** no auth. Private reads: require the Bearer key (else `404`).

> Private files return **404** (not 403) to callers without access, so their existence
> isn't revealed.

---

## Upload — `POST /api/v1/files`

Query: `?visibility=public|private` (default `private`). Two body styles:

**Raw bytes** (set the filename + type via headers):
```bash
curl -X POST "https://onprem-console.getoffgridai.co/api/v1/files?visibility=private" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Filename: report.pdf" \
  -H "Content-Type: application/pdf" \
  --data-binary @report.pdf
```

**Multipart form** (field name `file`):
```bash
curl -X POST "https://onprem-console.getoffgridai.co/api/v1/files?visibility=public" \
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
  "url": "https://onprem-console.getoffgridai.co/api/v1/files/26d64a9b-…"
}
```

## Retrieve — `GET /api/v1/files/{id}`

Returns the raw bytes with the original `Content-Type` and filename.
- **Public** file → works with no auth (the `url` above is shareable).
- **Private** file → send `Authorization: Bearer $API_KEY` (owner/admin only), else `404`.

```bash
# public
curl https://onprem-console.getoffgridai.co/api/v1/files/$ID -o out.pdf
# private
curl -H "Authorization: Bearer $API_KEY" https://onprem-console.getoffgridai.co/api/v1/files/$ID -o out.pdf
```

Metadata only (JSON, no bytes): `GET /api/v1/files/{id}?meta=1`.

## Make public / private — `PATCH /api/v1/files/{id}`

```bash
curl -X PATCH https://onprem-console.getoffgridai.co/api/v1/files/$ID \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"visibility":"public"}'      # or "private"
```
Returns the updated metadata. Owner or admin only.

## List your files — `GET /api/v1/files`

```bash
curl -H "Authorization: Bearer $API_KEY" https://onprem-console.getoffgridai.co/api/v1/files
# → { "files": [ { id, name, mime, size, visibility, url, … }, … ] }
```

## Delete — `DELETE /api/v1/files/{id}`

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  https://onprem-console.getoffgridai.co/api/v1/files/$ID
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
- The edge WAF + rate limit currently front the **gateway** host, not the console; say
  the word and I'll extend them to file endpoints too.
- The write key is the console admin token today — rotate `OFFGRID_ADMIN_TOKEN` for a
  strong value, or ask me to accept Keycloak service-account JWTs here too (same model
  as the gateway) so keys are Keycloak-issued.
