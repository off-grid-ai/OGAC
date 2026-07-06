# Chat

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Workspace → Chat (`/chat`)**.

## What it is

Your own ChatGPT, answered by the on-prem gateways — chat, with your projects and knowledge in reach. No per-seat cost; nothing leaves your infrastructure.

## Why use it

- A private, on-prem assistant for the whole org.
- Grounded in your Knowledge base with citations, and governed by Policy/Guardrails on every message.
- No cloud egress unless a routing rule leashes it there.

## When to use it

- Any everyday question, drafting, or analysis your team would otherwise take to a cloud chatbot.
- When you want an answer grounded in the org's own docs (attach a project / knowledge).

## How to use it

Open **Chat**, type. Use the project switcher to scope a chat to a Project (shared instructions + knowledgebase). Save a good output as an [Artifact](artifacts.md); save a good prompt to the [Prompts](prompts.md) library. Every message runs the governed pipeline — a blocked/redacted message is Policy/Guardrails acting, visible in the run history.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
