# Data & Retrieval

*Skeleton (how/what/why/when) — to be deepened.* Surface: **Data (`/data`, with Retrieval / Lineage / Integrations tabs)**.

## What it is

The Data section: connectors and ingestion, PII masking, the data catalog, the vector store (Qdrant) collections + health, and source→answer lineage.

## Why use it

- Bring source data in, mask PII on the way, and retrieve it with lineage.
- See vector collections and counts; trace every answer back to its sources.

## When to use it

- Wiring a connector or ingesting a dataset.
- Auditing where an answer's data came from (lineage).

## How to use it

Configure connectors and ingestion, define masking rules, browse the catalog, inspect Qdrant collections/counts, and open the lineage graph for a run. Tabs: sources, retrieval, lineage, integrations.

> This page is a skeleton written during the post-merge docs sweep. It covers what/why/when/how at a
> working level; deepen with screenshots and per-field detail in a later pass. See `docs/HOWTO.md`
> for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
