-- ─── Repair seeded chat threading: multiple roots orphan the transcript ────────────────────────────
--
-- listMessages() (src/lib/chat.ts) walks the parent-pointer tree from the root, choosing each parent's
-- ACTIVE child. Seeded conversations were written with EVERY user turn as a root (parent_id = null) and
-- the assistant replies attached to a later root — so the walk picked the first root, found it childless,
-- and stopped. The transcript rendered the question and no answer, and "< 1/2 >" was the two roots being
-- offered as branches of one turn.
--
-- Two repairs, in order.

-- 1. Only ONE assistant reply per parent may be active. Sibling replies are branches; marking them all
--    active makes the "active child" choice arbitrary.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY conversation_id, parent_id ORDER BY created_at) AS rn
  FROM chat_messages
  WHERE role = 'assistant' AND parent_id IS NOT NULL
)
UPDATE chat_messages m SET active = (r.rn = 1)
FROM ranked r WHERE m.id = r.id;

-- 2. Chain the extra roots. The first root stays the root; every later user turn is re-parented onto the
--    active assistant reply that precedes it, which is what a real conversation looks like.
WITH roots AS (
  SELECT id, conversation_id, created_at,
         row_number() OVER (PARTITION BY conversation_id ORDER BY created_at) AS rn
  FROM chat_messages WHERE role = 'user' AND parent_id IS NULL
)
UPDATE chat_messages m
SET parent_id = (
  SELECT a.id FROM chat_messages a
  WHERE a.conversation_id = m.conversation_id AND a.role = 'assistant'
    AND a.created_at < m.created_at AND a.active
  ORDER BY a.created_at DESC LIMIT 1
)
FROM roots r
WHERE m.id = r.id AND r.rn > 1
  -- Only when a preceding assistant reply exists to hang it from; otherwise leave it a root rather than
  -- inventing a parent and hiding the turn entirely.
  AND EXISTS (SELECT 1 FROM chat_messages a WHERE a.conversation_id = m.conversation_id
              AND a.role = 'assistant' AND a.created_at < m.created_at AND a.active);


-- 3. A later root with NO preceding assistant reply (repair 2 correctly refused to invent a parent for it)
--    is chained onto the PREVIOUS ROOT instead. Shape seen live in conv_285011f6cb84: root1 is a stray
--    user turn with no reply, root2 carries the real Q&A — so the walk picked root1, found it childless
--    and stopped, rendering a question and no answer. Chaining root2 → root1 puts every turn on one
--    reachable thread. Repeated until no conversation has more than one root.
WITH roots AS (
  SELECT id, conversation_id, created_at,
         row_number() OVER (PARTITION BY conversation_id ORDER BY created_at) AS rn,
         lag(id) OVER (PARTITION BY conversation_id ORDER BY created_at) AS prev_root
  FROM chat_messages WHERE parent_id IS NULL
)
UPDATE chat_messages m
SET parent_id = r.prev_root, active = true
FROM roots r
WHERE m.id = r.id AND r.rn > 1 AND r.prev_root IS NOT NULL;
