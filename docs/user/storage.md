# Storage

*Documented + verified 2026-07-07 (with one honest caveat — see below).* Surface: **Workspace → Storage (`/storage`)**.

## What it is

On-prem file storage and sharing. Upload any file, browse it in a folder view, control whether it's
**private** (needs auth to open) or **public** (a direct link anyone can open), and hand out
**expiring share links** — all stored on your own infrastructure, nothing leaving the box.

## Why use it

- A shared drive that never leaves your network — files sit in the on-prem object store, not a cloud
  bucket.
- Per-file control: private by default; flip one to public to get a copy-paste link, or mint a
  time-limited share link for an outsider without giving them a login.
- A place to keep the inputs and outputs that feed chats, projects, agents, and the Brain.

## When to use it

- Sharing a file internally (or with an outside party) without standing up a cloud drive.
- Publishing an asset (an image, a report) at a stable URL.
- Storing artifacts your workflows produce or consume.

## How to use it

Open **Storage**. Files are grouped into **folders** (derived from their path; flat uploads land under
**media**). A stats row shows totals; a filter bar switches between **All / Images / Videos /
Documents / Public / Private**.

### Upload

Drag files onto the **"Drop files here or click to upload"** zone (or click it). Every upload is
**private by default** — "Any file type · stored on-prem · private by default." You get a
"N file(s) uploaded" toast.

### Per-file actions

Each file card carries inline actions:

- **Copy URL** — copies the file's URL to your clipboard ("URL copied").
- **Open in new tab** — opens the file.
- **Share (expiring link)** — opens a dialog to mint a time-limited link (see below).
- **Make public / Make private** — toggles visibility ("File is now public/private"). A public file
  is served to anyone at its URL; a private file returns *not found* to anyone who isn't the owner or
  an admin.
- **Delete** — removes the file after a confirm ("File deleted").

### Expiring share links

Click **Share (expiring link)**, pick a lifetime — **15 min / 1 hour / 24 hours / 7 days** — and
**Create link**. The dialog shows the URL to copy and the expiry time.

> **Caveat (verified live 2026-07-07): expiring links do not currently expire on this fleet.** The
> on-prem object store has no signing keypair provisioned, so the "expiring" link degrades to the
> plain object URL and the dialog says so honestly ("this link cannot expire — it is the plain object
> URL. Provision S3 credentials to get true time-limited links."). Until a keypair is provisioned,
> treat a share link as a *public* link, not a temporary one. See GAPS below.

### Bucket settings (admin)

Admins get a **Bucket settings** panel for storage-wide rules:

- **Bucket access** — public (anonymous read of every object) vs private. Verified live: **private**.
- **Expiry rules** — auto-delete objects older than N days, optionally scoped to a path prefix. Verified
  live: **supported**, none configured. Add a rule, set the days and prefix, **Save settings**.

## How to check it's working

- **Upload → download roundtrip.** Upload a file; it appears on a card with the right size and type.
  Make it public, **Copy URL**, open the URL in a fresh tab — the file downloads back byte-for-byte.
  (Verified live: a public image listed at 50,238 bytes downloaded back at exactly 50,238 bytes from
  its copied URL.)
- **Private stays private.** Leave a file private and open its URL while signed out — you get *not
  found*, not the file. Sign in as the owner (or admin) and it opens.
- **Visibility toggles.** Flip a file to public and back; the badge and the toast track the change,
  and the URL's accessibility follows.
- **Delete removes it.** Delete a file; it disappears from the list and its URL stops serving.

## GAPS found

- **Expiring share links don't expire.** The object store has no signing keypair, so share links
  return `signed: false` and never expire — they're the plain public URL. The UI is honest about it,
  but the *time-limited sharing* outcome isn't delivered. Fix: provision S3-compatible credentials for
  the object store so links can be signed.
- **Public files with a nested path aren't served through the console API.** The console's own file
  listing returns URLs with nested keys (e.g. `provit/todo-demo/frames/step-000.png`), but the
  console API path `/api/v1/files/<key>` only lets *single-segment* public keys through unauthenticated
  — a nested public key is blocked with a 401 by the request gate (`FILE_GET = /^\/api\/v1\/files\/[^/]+$/`
  in `src/middleware.ts`). The direct object-store URL (`…/files/media/<key>`) works fine, and that's
  what **Copy URL** hands out, so end users are unaffected in practice — but the console API route for
  a nested public key is broken. Fix: change the whitelist regex to allow slashes in the file-GET path
  (e.g. `^/api/v1/files/.+$`), matching the catch-all `[...id]` route it fronts.

See `docs/FILE_STORAGE_API.md` for the API contract, `docs/HOWTO.md` for cross-surface recipes, and
`/docs/api` for the OpenAPI spec.
