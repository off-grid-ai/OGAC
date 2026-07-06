# Guardrails

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Governance → Guardrails (`/guardrails`)**.

## What it is

Input/output policy — PII detection (Presidio + a regex floor), prompt-injection detection, and grounding checks. The engine plus its rules.

## Why use it

- Catch and redact/block PII and injection before it reaches a model or a user.
- Grounding checks keep answers tied to sources.

## When to use it

- When tightening what's allowed in prompts/outputs.
- When a run was blocked/redacted and you need to see the rule.

## How to use it

View the active engine (Presidio when wired, else the regex floor), create/edit/delete masking + detection rules, and see recent guard actions. A guard block appears in the run timeline, SIEM, and provenance.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
