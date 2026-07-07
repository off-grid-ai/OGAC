# Projects

*Documented + verified 2026-07-07.* Surface: **Workspace → Projects (`/projects`, also reached from Chat's project switcher)**.

## What it is

A workspace per topic: a group of chats that all share the same **instructions** and the same
**knowledgebase**, plus a **project memory** of facts the assistant should carry across every
conversation in that project. A project isn't a separate app — it's a *context* you drop chats into
so they all behave the same way and can cite the same documents.

## Why use it

- Every chat in the project inherits the same system instructions — no re-pasting "you are our
  support agent, cite the policy docs" into each new chat.
- Chats in the project retrieve and **cite** the project's own documents, so answers are grounded in
  that topic's material.
- The project remembers durable facts (captured from its chats, or added by hand) and injects them
  into every conversation.
- Share the whole context with teammates — view-only or edit — so a case, product, or team works
  from one governed workspace.

## When to use it

- A standing body of work that recurs across many chats: a team, a customer case, a product line, an
  audit.
- When you want consistent instructions + grounding applied automatically, without attaching files
  turn by turn.
- When several people need to work in the same context with the same reference docs.

## How to use it

Open **Projects**. You'll see your projects as cards (name, instruction preview, chat count, last
update), a **Search projects** box, and — if anyone has shared with you — a **Shared with me**
section with **edit** / **view** badges.

### Create and open

1. Click **New project**. A project named "New project" is created and you land on its detail page
   (`/projects/{id}`).
2. The detail page is the workspace. The header shows chat count, doc count, the retrieval mode, and
   private/org visibility, plus **New chat in project** and (for owners) **Share**.

### Instructions (applied to every chat)

In the **Instructions** card, set the project **Name** and the **system prompt** ("How should the
model behave in this project?"), then **Save**. From then on, every chat you start inside the project
runs with that prompt.

### Knowledge (grounding the project's chats)

In the **Knowledge** card, click **Add files** (accepts `.txt`, `.md`, `.markdown`, `.csv`, `.json`,
and plain-text types). Each file is chunked and embedded on-prem so project chats retrieve and cite
it. The card shows a token meter and the **retrieval mode**:

- **retrieval: full-context** (green) — the whole knowledgebase fits in the window and is passed in
  full each turn (under ~100,000 tokens).
- **retrieval: RAG** (amber) — the knowledgebase is larger than the window, so chats retrieve only
  the most relevant chunks.

Delete a document with its trash icon.

### Project memory

In the **Project memory** card, add a fact the project should always remember (or delete one).
Facts are also captured automatically from the project's chats. They're injected into every
conversation in the project.

### Chats

Click **New chat in project** to start a conversation inside the project (`/chat?project={id}`); it
inherits the instructions, knowledge, and memory. The **Chats** card lists every conversation grouped
under the project — click one to open it. You can also switch a chat into a project from Chat's
project switcher.

### Share and delete

Owners click **Share** to set visibility — **private** (only you + people you invite) or **org**
(discoverable across the org) — and to invite people by email as **view** or **edit**. Delete a
project from its card (trash icon); the confirm notes that its chats are **kept but un-grouped**, not
destroyed.

## How to check it's working

- **Instructions take hold.** Save a distinctive instruction (e.g. "always answer in bullet points"),
  start **New chat in project**, ask anything — the answer follows the instruction. A chat started
  *outside* the project does not.
- **Knowledge becomes citable.** Add a `.md` file with a unique fact, wait for the
  "N chunks embedded" toast, then in a project chat ask about that fact — the answer returns it with a
  numbered `[n]` citation and a Sources footer pointing at your document. The doc count and token
  meter update immediately.
- **Memory persists.** Add a fact in Project memory, open a *new* project chat, and ask about it —
  the assistant already knows it.
- **Sharing works.** Set the project to org (or invite a teammate), and confirm it appears under their
  **Shared with me** with the right edit/view badge; a view-only member cannot save instructions.
- **Delete is safe.** Delete a project and confirm its former chats still exist in Chat's history,
  just no longer grouped.

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract.
