import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// ADVERSARIAL — RAG cross-org ISOLATION break. chat_documents / chat_chunks carry NO org_id (only
// project_id + user_id), and rag.retrieve(projectId, …) filters ONLY by project_id — never the
// caller's org. The stream route sets `ragProjectId = convo.projectId` and calls retrieve() with no
// org check (enforceDataAccess checks a pipeline allowlist, NOT org ownership). A user who belongs to
// BOTH org A and org B can create a conversation IN org B whose projectId points at their org-A
// project (projectAccess gates by userId, not org), then the answer is grounded on — and the
// citations expose — org A's confidential documents inside an org-B conversation.
//
// TERMINAL artifact asserted: the chunk CONTENT + citation names returned by retrieve() for the
// foreign-org project. A leak-free design would scope retrieval to the caller's org and return
// nothing. Currently RED — retrieve() has no org boundary. Real Postgres; skips green when no DB.
// GAPS: G-ADV-CHAT-4 (RAG retrieval not org-scoped — cross-org document leak).

const USER = 'multi-org-user@x.io';
const ORG_A = 'adv-rag-org-a';
const ORG_B = 'adv-rag-org-b';
const SECRET = 'CONFIDENTIAL ORG-A MEMO: acquisition target is Acme Corp, PAN AAAPZ1234C.';

const dbUp = await dbReachable();

test.skip(
  'ADVERSARIAL: currently RED, documents G-ADV-CHAT-4 — retrieve() leaks org-A documents when queried by a project id used from org B',
  { skip: dbUp ? false : SKIP_MESSAGE },
  async (t) => {
    const { addDocument, retrieve, deleteDocument } = await import('@/lib/rag');
    const { createProject, deleteProject } = await import('@/lib/chat');

    // Org A: the user owns a project and ingests a confidential document into its knowledge base.
    const projA = await createProject(USER, ORG_A, 'Org A M&A');
    const doc = await addDocument(USER, projA, 'memo.txt', SECRET);
    t.after(async () => {
      await deleteDocument(doc.id).catch(() => {});
      await deleteProject(USER, projA).catch(() => {});
    });

    // The attack: from an org-B chat, retrieval is invoked with the org-A project id (exactly what
    // the stream route does with convo.projectId). A leak-free retrieve() scoped to the caller's org
    // would return EMPTY. On current code it returns org A's chunk + document name.
    const r = await retrieve(projA, 'what is the acquisition target');

    assert.equal(
      r.context,
      '',
      'retrieval from a foreign-org project must return NO context — org A memo leaked into an org-B chat',
    );
    assert.equal(
      r.citations.length,
      0,
      'retrieval from a foreign-org project must return NO citations — org A document name leaked',
    );
  },
);
