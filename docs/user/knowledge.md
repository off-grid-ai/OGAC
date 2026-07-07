# Knowledge

*Documented + verified 2026-07-07.* Surface: **Workspace → Knowledge (`/knowledge`, page titled "Organization Knowledge")**.

## What it is

The org-shared corpus your **chat** answers from — "Ask Your Org," on-prem. Admins curate one or more
**collections** of documents; each is indexed on-prem and retrieved **permission-aware**, so answers
come back with clickable citations and people only ever ground on what their role is allowed to see.

> This is distinct from the **Agent knowledge base** inside Brain (`/brain?view=knowledge`), which is
> the corpus your *agents and the retrieval router* pull from. If you're curating docs for chat,
> you're in the right place; if you're feeding agents/router RAG, use Brain. The two surfaces
> cross-link to each other.

## Why use it

- One trusted source of truth the assistant cites — not a scatter of per-user uploads.
- Answers are **checkable**: every grounded reply carries numbered citations back to the exact
  document and section.
- **Permission-aware**: a collection can be limited to specific roles, so sensitive material is only
  retrieved for people allowed to see it. Everyone else's chats behave as if it isn't there.

## When to use it

- You want the whole org's chat grounded in SOPs, policies, product docs, or handbooks — with
  citations.
- You need a single curated corpus maintained centrally, rather than each person attaching their own
  files.
- Some material must be role-restricted (HR, legal, finance) while the rest is org-wide.

## How to use it

Open **Knowledge**. You see the collections your role can access as a table — **Collection**,
**Access** (the roles allowed, or an **Everyone** badge), **Documents** (count), and (for admins) a
**Manage** action. Click a collection name to open its detail page.

### Create a collection (admin)

1. Click **New collection**. In the panel, set:
   - **Name** and an optional **Description**.
   - **Allowed roles** — comma-separated (e.g. `admin, editor`). **Leave blank to allow everyone.**
2. Click **Create**. The collection appears in the table with its access shown as the role list or
   **Everyone**.

### Add documents (admin)

1. Open the collection (`/knowledge/{id}`). The **Documents** card explains: "Index text documents
   into this collection — each is chunked and embedded on-prem."
2. Use the file input (accepts `.txt`, `.md`, `.markdown`, `.csv`, `.json`, and plain-text types) to
   add a document. On success you get a toast: **Indexed "{name}" (N chunks)**.
3. The document is now searchable and citable in chat. Remove one with its trash icon (this also
   removes it from search immediately).

The collection detail also shows an **Access** panel (allowed roles, document count, who created it).
There's no in-place "edit document" — to change a document, delete it and re-add the new version
(that re-indexes it).

### Use it in chat

In **Chat**, open the Tools menu and turn on **Search org knowledge**. From then on the assistant
retrieves relevant passages from the collections your role can access, weaves them into the answer,
and shows numbered `[n]` citations with a Sources footer naming the document, its collection, and the
matched section. See [Chat](chat.md) for how citations render.

## How to check it's working

- **A doc becomes searchable + citable.** Create a collection, add a `.md` file containing a unique
  sentence (e.g. "The widget warranty is 37 months"), wait for the **Indexed "…" (N chunks)** toast.
  Then in Chat with **Search org knowledge** on, ask "how long is the widget warranty?" — the answer
  returns *37 months* with a `[1]` citation pointing at your document and collection.
- **Permission-awareness holds.** Restrict a collection to a role you don't hold; confirm its docs no
  longer appear in your chat's citations, while an admin still retrieves them. In the collections
  table, a non-admin only sees collections open to their role.
- **Removal takes effect.** Delete a document, then re-ask the same question — the assistant no longer
  cites it.
- **Live status.** In production the collections API is session-scoped (it answers to a signed-in
  operator, not a service token), so verify it by signing in and loading `/knowledge` rather than by
  calling the endpoint with an admin token.

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract.
