# Chat

*Fully documented (post-chat-epic sweep, 2026-07-06).* Surface: **Workspace → Chat (`/chat`)**.

## What it is

Your own ChatGPT, answered by the on-prem gateways — with your projects, memory, and knowledge in
reach, and every message run through the governed pipeline (Policy/Guardrails/budget). No per-seat
cost; nothing leaves your infrastructure unless a routing rule sends it there.

## Why use it

- A private, on-prem assistant for the whole org — no cloud egress by default.
- Answers grounded in your own docs, **with clickable citations** back to the source.
- Governed on every message: RBAC on models/skills, PII/injection guardrails, and a hard per-project
  budget gate.

## When to use it

- Any everyday question, drafting, or analysis your team would otherwise take to a cloud chatbot.
- When you want an answer grounded in the org's own docs — scope the chat to a Project, opt into
  "Ask Your Org", or `@`-mention specific memories/KBs/documents.
- When you need a small artifact (a page, chart, script) generated and then tweaked in place.

## How to use it

Open **Chat** and type. The composer and transcript carry the features below.

### Grounding: projects, org knowledge, and @-mentions

- **Project scope** — pick a Project in the switcher to apply its shared instructions and retrieve
  from its knowledgebase. Grounded answers cite their sources (see Citations).
- **Ask Your Org** — toggle org-wide knowledge to retrieve permission-aware chunks across the org KB
  (you only ever see collections your role may access).
- **@-mentions** — type `@` to open a picker of your **memories**, **projects (whole KB)**, and
  **individual documents**. Pick one to attach it as a removable chip; it grounds *this turn only*.
  Referenced memories are injected as context; referenced KBs/docs are retrieved **and access-gated**
  (you can only reference a project you can read) and **fold into the same citations** as project/org
  retrieval — so an @-mentioned KB produces the same numbered `[n]` chips and Sources footer.

### Citations

When an answer uses retrieved knowledge, the model cites it inline with bracketed numbers (`[1]`,
`[2]`). Each `[n]` is a **clickable chip** — click it to jump to that entry in the **Sources footer**
under the message, which briefly highlights. The footer lists each distinct source once (deduped),
its matched parts, and a relevance score. No sources → no footer; a dangling number renders as inert
text. Citations cover project RAG, "Ask Your Org", @-mentioned KBs, and executed connector tools.

### Thinking (extended reasoning)

Turn on **Thinking** in the Tools menu to have the model reason before answering. Its reasoning
streams live in a **Thinking block ABOVE the answer**, then **collapses automatically once the answer
starts** — click to re-open it. Off by default (saves prefill on local hardware).

### Artifacts (generate + edit in place)

When a reply contains a renderable output (HTML, SVG, React, Mermaid, or runnable Python/Node), a
chip opens it in a side panel. There you can:

- **Preview** it live (sandboxed iframe) or **Run** it (Python/Node executes in the console sandbox,
  stdout/stderr shown inline).
- **Edit** the source in place — the preview re-renders as you type. **Save** persists a **new
  version** through the artifacts library (Cmd/Ctrl+S in the editor; Esc cancels). Save keys on
  (you, conversation, title), so an edit appends a version to the same artifact rather than forking a
  duplicate.
- **Refine** — describe a change in plain language ("add a dark-mode toggle") and the model
  re-generates the artifact.

Saved artifacts live in the [Artifacts](artifacts.md) library.

### Voice (audio mode)

The composer supports **speech-to-text** (tap the mic to dictate) and **read-aloud** (the speaker
button on an assistant message reads it back). Audio I/O runs in the browser; nothing is stored.

### Conversation management

- **Edit & branch** — edit a prior user turn to fork a new branch (the old answer is kept as a
  sibling; step between branches with the arrows).
- **Regenerate** an answer, **copy** it, or start a **Temporary (incognito)** chat that is never
  persisted and never added to memory.
- **Attach files** for one turn — extracted to text and injected as context (not embedded).
- **Skills** — invoke an org skill inline (`/`) for one turn, or bind one to the whole conversation.

### Governance you'll see

- A **model or skill your role can't use** is refused with a message.
- A call that would **exceed the project budget** is hard-blocked (402) with the shortfall shown, and
  the denial is written to the [Audit Log](audit-logs.md).
- Every completion is audited and traced to [Observability](observability.md); durable facts are
  distilled into your memory (except in Temporary chats).

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract.
