# Storage

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Workspace → Storage (`/storage`)**.

## What it is

Upload, browse, and share files — stored on-prem, never leaving your infrastructure. Public or private per file, with an S3-compatible URL.

## Why use it

- On-prem file storage with per-file visibility and shareable URLs.
- Nothing leaves the box; a private file needs auth, a public file has a direct URL.

## When to use it

- Sharing a file internally without a cloud drive.
- Storing inputs/outputs that feed chats, agents, or the Brain.

## How to use it

Upload a file, set public/private, copy its URL, browse and delete. Files are served from the on-prem object store (see `docs/FILE_STORAGE_API.md` for the API).

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
