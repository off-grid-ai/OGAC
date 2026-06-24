import { readFile } from 'fs/promises';
import { join } from 'path';

// The hosted handbook — the prose docs (integration / operations / running) served in-app at
// /handbook, alongside the API reference at /docs. Source of truth is the markdown in docs/,
// read at request time so the hosted docs never drift from the repo.
export interface HandbookDoc {
  slug: string;
  title: string;
  blurb: string;
  file: string;
}

export const HANDBOOK: HandbookDoc[] = [
  {
    slug: 'concepts',
    title: 'Concepts — who does what & why',
    blurb: 'Each control: what it is, who owns it, how to set up/configure, and why.',
    file: 'CONCEPTS.md',
  },
  {
    slug: 'running',
    title: 'Running the full stack',
    blurb: 'One command for all five layers; profiles, ports, variants.',
    file: 'RUNNING.md',
  },
  {
    slug: 'integrations',
    title: 'Integrations (adapter layer)',
    blurb: 'Capability ports, swapping a tool, the full capability map.',
    file: 'INTEGRATIONS.md',
  },
  {
    slug: 'catalog',
    title: 'Integration catalog',
    blurb: 'Every service: what · why · when · how to configure (env, profile, adapter id).',
    file: 'CATALOG.md',
  },
  {
    slug: 'agent-qa',
    title: 'Agent QA — evals, scoring & drift',
    blurb: 'Automated QA for agents: offline evals, online Langfuse scoring, drift/degradation.',
    file: 'AGENT_QA.md',
  },
  {
    slug: 'operations',
    title: 'Operations runbook',
    blurb: 'Every integration: how it works, how to operate, verify, swap.',
    file: 'OPERATIONS.md',
  },
  {
    slug: 'runbooks',
    title: 'Runbooks',
    blurb: 'Step-by-step operational procedures: enroll, kill, rotate, incident, backup, swap.',
    file: 'RUNBOOKS.md',
  },
  {
    slug: 'use-cases',
    title: 'Use cases',
    blurb: 'End-to-end scenarios across the planes (regulator, residency, cost, audit, SOPs).',
    file: 'USECASES.md',
  },
  {
    slug: 'how-to',
    title: 'How-tos',
    blurb: 'Concrete recipes (UI + API): keys, routing, ingest, evals, grounding, SDK.',
    file: 'HOWTO.md',
  },
  {
    slug: 'licenses',
    title: 'Licensing & legal',
    blurb: 'Dual-license model and the permissive OSS audit.',
    file: 'LICENSES.md',
  },
];

export function findDoc(slug: string): HandbookDoc | undefined {
  return HANDBOOK.find((d) => d.slug === slug);
}

export async function readDoc(doc: HandbookDoc): Promise<string> {
  try {
    return await readFile(join(process.cwd(), 'docs', doc.file), 'utf8');
  } catch {
    return `# ${doc.title}\n\n_Document not found._`;
  }
}
