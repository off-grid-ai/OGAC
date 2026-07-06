# Artifacts

*Fully documented (post-chat-epic sweep, 2026-07-06).* Surface: **Workspace → Artifacts
(`/artifacts`, Workspace tabs)**.

## What it is

A library of generated outputs — HTML, SVG, React, Mermaid diagrams, and runnable code — saved from
your chats, **versioned**, and reopenable anytime.

## Why use it

- Keep the useful things the assistant produced instead of losing them in chat scrollback.
- Reopen, run, edit, or iterate on a saved output later — with a version history so you can see how
  it changed.

## When to use it

- Whenever a chat produces something worth keeping (a component, a diagram, a script).
- When you want a durable, re-editable copy of a generated output.

## How to use it

**From chat:** when a reply contains a renderable output, open it via the artifact chip. In the side
panel you can Preview it live, Run it (Python/Node), **Edit** the source in place, and **Save**.

**Editing + versioning:** Save persists a **new version** rather than a duplicate — versions are
keyed by (you, conversation, title), so editing an artifact and saving appends a version to the same
logical artifact. Identical content is a no-op (no empty version is ever written). Save is only
enabled when the buffer both differs from the last save and is non-empty. In the editor, Cmd/Ctrl+S
saves and Esc cancels back to the last saved version.

**From the library:** browse, reopen, run, edit, and delete saved artifacts. Reached via the
Workspace top-tabs.

See `docs/HOWTO.md` for step-by-step recipes and `/docs/api` for the API contract (POST
`/api/v1/chat/artifacts`).
