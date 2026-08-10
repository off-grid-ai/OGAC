// ─── Give Suraksha's knowledge base the same shape Bharat Union's has ──────────────────────────────
//
// LIVE FINDING (2026-08-10). /data/knowledge measured 231 characters on the insurer tenant — thin
// enough that the buyer-facing demo audit flagged it. The bank tenant audits fine at the same URL.
// The cause was not missing data: org_suraksha already has 10 real, indexed documents (life, health
// and motor SOPs — see scripts/seed-suraksha-corpus.sql). They just all sit in ONE collection
// ("Insurance Policies & SOPs"), so the page renders a single thin card instead of the multi-card
// grid the bank tenant shows across its 6 topical collections (KYC & AML, Motor Claims, Lending &
// Underwriting, Product & Pricing, HR & Reimbursement, …).
//
// This reorganizes the SAME 10 documents (no content changes, no re-embedding — only which
// collection each doc/chunk belongs to) into 4 topical collections that match how the tenant's own
// apps talk about the business: Underwriting & Product, Life & Health Claims, Motor Claims, and
// Policy Operations & Grievance. The old single collection is deleted once it is empty.
//
// Idempotent: safe to re-run. Each doc is only moved if it isn't already in its target collection;
// collections are created with a deterministic id via `onConflictDoNothing`; the old collection is
// only deleted once empty.
//
// Run ON the box (tsx, reads .env.local):
//   cd ~/offgrid/console && /usr/local/bin/node --env-file=.env.local node_modules/.bin/tsx \
//     scripts/split-suraksha-knowledge-collections.mts [--dry]

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { orgKnowledgeChunks, orgKnowledgeCollections, orgKnowledgeDocs } from '../src/db/schema.ts';
import { createCollection, deleteCollection, listCollections } from '../src/lib/org-knowledge.ts';

const DRY = process.argv.includes('--dry');
const ORG_ID = 'org_suraksha';
const OLD_COLLECTION_ID = 'd93bff10-2e43-4263-bc25-eb39abba8d14'; // "Insurance Policies & SOPs"
const CREATED_BY = 'priya.nair@surakshalife.example'; // the persona that owns the tenant's existing collection

interface NewCollection {
  id: string;
  name: string;
  description: string;
  docs: readonly string[]; // exact org_knowledge_docs.name values to move here
}

const NEW_COLLECTIONS: readonly NewCollection[] = [
  {
    id: 'kc_suraksha_underwriting',
    name: 'Underwriting & Product',
    description: 'Life and health product terms, rate cards and eligibility rules.',
    docs: [
      'Life Underwriting OYRT Rate Card Guide',
      'Health Indemnity Policy Wording (IRDAI)',
      'Health Top-Up & Super Top-Up Eligibility Rules',
      'Hospitalisation & Room-Rent Sub-Limit Guide',
    ],
  },
  {
    id: 'kc_suraksha_life_health_claims',
    name: 'Life & Health Claims',
    description: 'Death-claim assessment and cashless health pre-authorisation SOPs.',
    docs: ['Death-Claim Assessment SOP', 'Cashless Network & Pre-Authorisation SOP'],
  },
  {
    id: 'kc_suraksha_motor_claims',
    name: 'Motor Claims',
    description: 'Motor FNOL intake, survey allocation and own-damage assessment SOPs.',
    docs: ['Motor FNOL Intake & Survey Allocation SOP', 'Motor Own-Damage Claim Assessment SOP'],
  },
  {
    id: 'kc_suraksha_policy_ops',
    name: 'Policy Operations & Grievance',
    description: 'Lapse, revival and grace-period rules, and IRDAI grievance redressal.',
    docs: ['Policy Lapse, Revival & Grace Period Rules', 'Grievance Redressal Policy (IRDAI)'],
  },
];

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  log(DRY ? '── DRY RUN ──' : '── applying ──');

  const before = await listCollections('admin', ORG_ID);
  log(`before: ${before.length} collection(s) for ${ORG_ID}`);

  for (const col of NEW_COLLECTIONS) {
    if (DRY) {
      log(`  would ensure collection ${col.id} "${col.name}"`);
    } else {
      await createCollection(CREATED_BY, { id: col.id, name: col.name, description: col.description }, ORG_ID);
      log(`  ensured collection ${col.id} "${col.name}"`);
    }

    for (const docName of col.docs) {
      const [doc] = await db
        .select({ id: orgKnowledgeDocs.id, collectionId: orgKnowledgeDocs.collectionId })
        .from(orgKnowledgeDocs)
        .where(eq(orgKnowledgeDocs.name, docName))
        .limit(1);
      if (!doc) {
        log(`  ! document not found, skipping: "${docName}"`);
        continue;
      }
      if (doc.collectionId === col.id) {
        log(`  = "${docName}" already in ${col.id}`);
        continue;
      }
      if (DRY) {
        log(`  would move "${docName}" ${doc.collectionId} -> ${col.id}`);
        continue;
      }
      await db
        .update(orgKnowledgeDocs)
        .set({ collectionId: col.id })
        .where(eq(orgKnowledgeDocs.id, doc.id));
      await db
        .update(orgKnowledgeChunks)
        .set({ collectionId: col.id })
        .where(eq(orgKnowledgeChunks.docId, doc.id));
      log(`  moved "${docName}" ${doc.collectionId} -> ${col.id}`);
    }
  }

  // Retire the old bucket once it's empty. Never delete it while it still holds a document — that
  // would be silent data loss if a name above didn't match (a typo, a doc renamed since).
  const [{ n: remaining }] = (
    await db.execute(sql`
      SELECT count(*)::int AS n FROM org_knowledge_docs WHERE collection_id = ${OLD_COLLECTION_ID}
    `)
  ).rows as { n: number }[];
  log(`\nold collection ${OLD_COLLECTION_ID} now holds ${remaining} document(s)`);
  if (remaining === 0) {
    if (DRY) {
      log('  would delete the now-empty old collection');
    } else {
      await deleteCollection(OLD_COLLECTION_ID, ORG_ID);
      log('  deleted the now-empty old collection');
    }
  } else if (remaining > 0) {
    log('  NOT deleting — it still has documents (check the names above for a mismatch)');
  }

  const [oldRow] = await db
    .select({ id: orgKnowledgeCollections.id })
    .from(orgKnowledgeCollections)
    .where(and(eq(orgKnowledgeCollections.id, OLD_COLLECTION_ID), eq(orgKnowledgeCollections.orgId, ORG_ID)))
    .limit(1);
  log(`old collection still present: ${Boolean(oldRow)}`);

  const after = await listCollections('admin', ORG_ID);
  log(`\nafter: ${after.length} collection(s) for ${ORG_ID}`);
  for (const c of after) log(`  - ${c.id} "${c.name}"`);
}

await main();
process.exit(0);
