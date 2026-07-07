# Prompts

*Documented + verified 2026-07-07.* Surface: **Workspace → Prompts (`/prompts`, Workspace tabs)**.

## What it is

A shared library of reusable prompt texts — the good ones your team keeps re-typing, saved once and
kept in reach. Each prompt can carry `{{variable}}` placeholders so it works as a template. Alongside
your own library, the page surfaces a **Starter library** of ready-made prompts and a **Common
prompts** panel that shows what your org is actually asking the assistant most often.

## Why use it

- Stop re-typing the prompt that works. Save it once; the whole team uses the same wording.
- Standardize *how* the org asks — a curated prompt gives everyone the same quality of answer.
- See what people already lean on (Common prompts), and promote the best into the library so it's
  official, not folklore.
- Start from a proven template instead of a blank box (Starter library).

## When to use it

- A prompt produced a great result and you'll want it again — save it.
- You're onboarding a team to a repeatable workflow and want one canonical prompt they all copy.
- You keep seeing the same request typed slightly differently across the org — check Common prompts,
  pick the strongest phrasing, and save it as the standard.

## How to use it

Open **Prompts**. The page stacks three sections: **your library** (top), the **Starter library**,
and **Common prompts**.

### Your library — create, edit, delete

1. Click **New prompt** (top right). A create panel slides in from the right; the URL updates to
   `?panel=new` so Back closes it and the panel is deep-linkable.
2. Fill the fields:
   - **Title** — e.g. "Weekly status summary".
   - **Prompt text** — the body. Use `{{variable}}` anywhere you want a fill-in slot; the console
     auto-detects them and shows each as a `{{name}}` chip on the card.
   - **Tags** — comma-separated, for filtering (e.g. `support, drafting`).
   - **Share with org** — leave unchecked to keep it private to you; check it to make the prompt
     visible to everyone in the org (it then shows an **Org** badge).
3. Click **Save**. The prompt appears in the grid.
4. **Edit** — click the pencil on any prompt you own (panel opens at `?panel={id}`). **Delete** —
   click the trash icon. Only the owner can edit or delete a prompt; org-shared prompts are
   read-only to everyone else (they can still use them).
5. **Use a prompt** — click **Use →** on a card. The full prompt text is copied to your clipboard
   ("Copied — paste it into any chat") and the prompt's use-count ticks up. Paste it into any Chat
   composer and fill in the `{{variables}}`.

Search the library with the **Search prompts…** box (matches title + body), and narrow by clicking a
**tag** badge (click **clear** to reset).

### Starter library — begin from a proven template

Below your library, the **Starter library** holds curated, ready-to-use prompts (summarize & tag,
extract to JSON, meeting notes → action items, grounded support reply, translate, SOP writer, clause
review, classify intent). Click **Add to my prompts** on any starter to drop a copy into your library
tagged `starter` — then edit it however you like.

### Common prompts — what the org actually asks

The **Common prompts** panel mines your gateway usage history and shows the most-frequently-sent
prompts across the org, each with a `count×` badge. Click **Save** on one to add it to your personal
library so you can refine and standardize it. If usage history isn't available yet, the panel says so
honestly ("Usage history unavailable") rather than showing nothing.

## How to check it's working

- **A prompt saves and re-opens.** Create a prompt, Save, refresh the page — it's still in the grid.
  Click its pencil; the panel re-opens with your exact title, body, tags, and share setting. Deep-link
  the edit URL (`/prompts?panel={id}`) in a new tab — it opens that prompt.
- **Variables are detected.** Put `{{customer_name}}` in the body and Save — a `{{customer_name}}`
  chip appears on the card.
- **Use actually copies.** Click **Use →**, then paste into a Chat message — the full text lands, and
  the card's use-count increments on your next refresh.
- **Sharing is honored.** Check **Share with org**, Save — the card shows an **Org** badge; a
  teammate sees the prompt in their library (and cannot edit it).
- **Common prompts is live** when the panel lists real prompts with `count×` badges (verified in
  production: 25 mined prompts, top entry seen 45×). If it shows "unavailable," usage history hasn't
  been wired on this fleet yet — the rest of the surface still works.

See `docs/HOWTO.md` for cross-surface recipes and `/docs/api` for the API contract.
