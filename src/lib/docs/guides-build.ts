import type { DocSection } from './types';

export const buildSection: DocSection = {
  id: 'build',
  label: 'Build with AI',
  pages: [
    {
      slug: 'guides/chat',
      title: 'Chat',
      description: 'Your private AI, everywhere — grounded, governed, and answered on your own hardware.',
      body: `Chat is your org's private assistant. It streams from your own gateways, so prompts and
answers stay on your network.

![Chat — a grounded, governed conversation answered on your own gateway](/docs-shots/chat.png)

## What it does

- **Models on your hardware.** Pick a model from the picker; the answer is generated on your gateway
  nodes. Vision models read images; image models generate them.
- **Projects.** Group related chats under shared instructions and a knowledgebase — a workspace per
  topic. See [Projects](/docs/guides/projects).
- **Knowledge grounding.** With grounding on, the assistant answers only from your uploaded
  documents and cites them, so it won't invent facts. See [Knowledge](/docs/guides/knowledge).
- **Skills and tools.** Type \`/\` to invoke a skill, or give an agent tools so it can act.

## Message actions

Stop a running answer mid-stream, retry a turn (same or different model), edit a previous message
and branch the conversation, and copy or rate any reply. Failed turns show the reason inline with a
one-click retry, and your prompt is never lost.

## Attachments

Drag and drop or paste images and files onto the composer. Images show as inline thumbnails and open
in a lightbox; text files (txt, md, csv, pdf) are extracted and injected as context for the turn.

## Keyboard

- \`Enter\` sends, \`Shift+Enter\` for a newline.
- \`/\` opens the skills palette.`,
    },
    {
      slug: 'guides/image-generation',
      title: 'Image generation',
      description: 'Generate images on your own image gateway, right inside chat.',
      body: `Image generation lives inside Chat — there's no separate tool to learn. Pick an image
model and the composer switches to generating.

## Generate an image

1. In Chat, open the model picker and choose a model tagged **(image)** (e.g. an on-prem
   Stable-Diffusion checkpoint).
2. The composer placeholder changes to "Describe an image to generate".
3. Type a prompt and send. The image renders in the thread and is saved to your storage.

## Where it runs

Generation runs on your own image gateway node (stable-diffusion.cpp behind the same
OpenAI-compatible gateway as chat). The prompt and the result never leave your infrastructure. Each
image is stored in your object store, so it's also visible in [Storage](/docs/guides/storage).

## Tips

- On CPU nodes, generation takes longer than chat — a low step count is faster for drafts.
- Every generated image is a real file in your store; nothing is fabricated or held back.`,
    },
    {
      slug: 'guides/agents',
      title: 'Agents',
      description: 'Assistants that act — grounded, tool-using, and run through the governed pipeline.',
      body: `An agent is an assistant with a job and capabilities. You give it instructions, ground it in
your knowledge, and grant it tools; every run flows through the governed pipeline.

![Agents — assistants with instructions, grounding, and governed tools](/docs-shots/agents.png)

## Create one

On the **Agents** page, create an agent from plain-language instructions. Ground it in your
knowledge (on by default, so it cites sources and won't hallucinate) and grant it tools — the
connectors your org has set up. Each granted tool still obeys its action policy: allow, needs
approval, or blocked. Capability never bypasses governance.

## Run and watch it

Open an agent and run it with a query. You see the full pipeline execute — policy, guardrails,
retrieval, answer, grounding, provenance — with the steps, guardrail verdicts, and citations shown
inline. Re-run a past run, cancel one in flight, or send a run through human review.

## Grounded vs. open

- **Grounded (default)** — retrieves from your knowledge and answers only from sources, with
  citations. Best for support, policy, and research assistants.
- **Open** — answers from the model directly, for drafting or brainstorming assistants that don't
  need your documents.

## No special powers

A custom agent carries no special access. It runs the same governed path as the built-ins, so it
inherits every convention set on your console.`,
    },
    {
      slug: 'guides/agent-runs',
      title: 'Agent runs',
      description: 'Every governed run, with its full pipeline trace — re-run, cancel, or send to review.',
      body: `Agent runs is the history and the microscope for everything the agents did. Each run is a
governed execution you can open and read stage by stage.

## What a run shows

Open any run to see the pipeline execute in order — policy, guardrails, retrieval, answer, grounding,
provenance — with each stage's timing, guardrail verdicts, and the citations the answer drew on. A
blocked or denied run shows exactly where and why it stopped; that's a valid governed outcome, not an
error to hide.

## Act on a run

- **Re-run** a past run with the same input to reproduce or compare.
- **Cancel** a run in flight.
- **Send to review** — route a run through human approval when policy calls for it.

## One id, four planes

A run's id ties it together across the [audit ledger](/docs/guides/audit), the
[trace store](/docs/guides/observability), [lineage](/docs/guides/lineage), and the signed
[provenance](/docs/guides/provenance) record. Copy a run id and you can pull the same run from any of
them.`,
    },
    {
      slug: 'guides/brain',
      title: 'Brain',
      description: 'The power-user workbench — documents, retrieval, tools, router, and evals in one place.',
      body: `Brain is the workbench for the person tuning the retrieval-and-reasoning core directly. Where
[Knowledge](/docs/guides/knowledge) and [Studio](/docs/guides/studio) hide the machinery, Brain
exposes it, so you can inspect and tune each part.

## What it exposes

- **Documents** — ingest and manage the corpus Brain retrieves from, and search it directly.
- **Retrieval** — run a query and see the chunks that come back, to check what a grounded answer
  would draw on.
- **Grounding verifier** — check an answer against its sources on demand.
- **Tools** — register and toggle the tools an agent can call.
- **Router** — try a prompt against the routing rules and see where it would land.
- **Prompts & golden cases** — manage reusable prompts and the eval golden set, and run an eval.

Brain is for builders and platform operators who want the controls in the open. Everything it runs
still flows through the same governed pipeline as the rest of the console.`,
    },
    {
      slug: 'guides/retrieval',
      title: 'Retrieval',
      description: 'Inspect and tune the vector store behind every grounded answer.',
      body: `Retrieval is the data-plane view of grounding: the vector store your grounded answers draw
from, and the controls to keep it healthy. [Knowledge](/docs/guides/knowledge) is where you add
content; Retrieval is where you inspect how it's indexed and served.

![Retrieval — collections, backend, and a live query against the vector store](/docs-shots/retrieval.png)

## What you do here

- **Inspect the store** — see collections and their document/chunk counts, and which vector backend
  is active (an embedded store by default, or your own Qdrant at scale).
- **Query it** — run a retrieval query and see the ranked chunks, so you can verify what a grounded
  answer would find before an agent runs.
- **Reindex** — rebuild the index after adding or changing content.

## Permissions-aware

Retrieval respects the same access rules as the rest of the console: an answer only ever draws on
sources the asker is allowed to see, so grounding never becomes a way around policy. See
[Permissions-aware retrieval](/docs/guides/permissions-aware) for exactly how a document's audience
is bound and enforced.`,
    },
    {
      slug: 'guides/permissions-aware',
      title: 'Permissions-aware retrieval',
      description: 'An answer only ever cites what the person asking is allowed to see.',
      body: `The fastest way to leak a secret with AI is to ground on a document the asker was never
allowed to open. Permissions-aware retrieval closes that: grounding is bound to the same access rules
as everything else, so an answer can only ever cite sources the person asking is permitted to see.

## Document-level, not just project-level

Grounding used to be scoped by project — everyone in a project saw everything in it. Now each
document can carry its own audience, and retrieval filters to it per asker:

- **Owner** — the person who added the document always sees it.
- **Allowed subjects** — specific people, by email or id.
- **Allowed roles** — a whole role (e.g. \`claims\`, \`legal\`), so access follows the org chart.
- **Data class** — rides along for filtering and audit; it labels, it doesn't by itself grant access.

## Default-safe, and backward compatible

The rule is deliberately conservative at both ends:

- A document with **no** audience set stays visible exactly as before, so existing content doesn't
  vanish the day you turn this on.
- A document that **does** carry an audience is hidden from anyone who doesn't match at least one
  grant — even if it's sitting in their project. Present-but-unmatched means hidden, not shown.

An \`admin\` role is the one break-glass that sees everything, kept small and explicit.

## Enforced twice, so it can't slip

The audience check is applied where the vector store can express it (as a metadata filter, so
disallowed documents never come back) **and** as a post-filter on the results as defence in depth.
A backend that can't filter server-side still gets the same outcome. Either way, an answer's
citations are a subset of what the asker could open by hand — grounding is never a way around
[Policy](/docs/guides/policy).`,
    },
    {
      slug: 'guides/provit',
      title: 'Provit',
      description: 'Point it at a repo; it maps every behavior, runs each end to end, and judges the result with vision.',
      body: `Provit answers a question every team dreads: does the app still do what it's supposed to.
Point it at a repository and it maps the app into behaviors, runs each one end to end, and judges the
recording with a vision model — so "it works" becomes evidence, not a hope. Provit is a first-class
console module, brokered through the console's own auth, fleet, and budgets.

## What you can do here

- **Run its intelligence** — the feature-mapping, test-synthesis, and copilot engine, driven from the
  console rather than a separate tool.
- **Upload a file** — send a file to Provit through the console's own [Storage](/docs/guides/storage),
  so an artifact goes in without leaving your infrastructure.
- **See your repos and runs** — repos your org maps stay private to your org; free demo runs live in
  the public showcase.
- **Open Provit** — jump to the full product with the reachability status shown inline, so you know
  it's live before you go.

## It rides the console's gateway

Provit does not run its own model gateway. Its intelligence — feature mapping, test synthesis, the
copilot, and the vision judge — runs on **this console's** [gateway](/docs/guides/gateway). Point a
Provit instance at the console and every one of those calls inherits the same fleet, routing,
governance, and [budgets](/docs/guides/budgets) as the rest of the platform. Nothing about Provit
sits outside the leash.

## Private by default

Repos and runs are scoped by the console's access rules (ABAC on the \`provit\` resource, plus
tenancy): you see the public library, your own org's repos, and your own private ones — nothing
else. A fresh account simply shows an empty list, never someone else's work.`,
    },
    {
      slug: 'guides/studio',
      title: 'Studio',
      description: 'Build a working assistant in plain language — no technical setup.',
      body: `Studio is for the people who know the work but not the plumbing. You describe an assistant
in plain language and Studio wires the model, policy, guardrails, and grounding for you.

## The flow

1. **Describe** what the assistant should do. Off Grid can suggest a name, the relevant skills, and
   whether it should use your uploaded knowledge — inferred from your description.
2. **Pick skills** — the tools your org has set up.
3. **Choose knowledge** — whether it answers from your documents.
4. **Try it** right there, then **publish** — to just you, your org, or a shareable link.

## What's hidden

None of the technical settings (model choice, sampling, token limits, embeddings) are exposed. They
are handled for you, under the same governance as everything else. A published assistant is a real
governed agent plus a saved template that points at it — so it runs the same pipeline as anything
built by hand.

## Sharing

- **Just me** — private to you.
- **My org** — everyone can find and use it.
- **Shareable link** — publishes a direct \`/app/<name>\` link that runs through the governed
  pipeline even without a console login.`,
    },
    {
      slug: 'guides/knowledge',
      title: 'Knowledge & retrieval',
      description: 'Turn your documents and systems into grounded, cited answers.',
      body: `Knowledge is how your own content becomes answerable. You upload documents or connect a
system; Off Grid indexes it on your hardware; Chat and agents answer from it with citations.

![Knowledge — upload documents and index connected sources for grounded answers](/docs-shots/knowledge.png)

## Add knowledge

Upload files on the **Knowledge** page (PDFs, text, docs) or index a connected data source. Off Grid
chunks the content and embeds it using a model on your own gateway — no embedding service, no data
sent out. The vector store is yours (an embedded store by default, or your own Qdrant at scale).

## How grounding works

When a grounded assistant answers, it retrieves the most relevant chunks, composes an answer from
them, and verifies the answer against the sources. Every reply carries \`[Source: …]\` citations you
can click through. If the sources don't cover the question, the assistant says so rather than
inventing an answer.

## Manage it

The Knowledge and Retrieval surfaces let you add, list, and remove documents, inspect the vector
store, and reindex — the console is how you run it, not just view it.`,
    },
    {
      slug: 'guides/projects',
      title: 'Projects',
      description: 'A dedicated workspace per topic — shared instructions and a knowledgebase.',
      body: `A project groups chats under shared instructions and its own knowledgebase, like a
dedicated workspace for a topic, team, or client.

## Use it

- Create a project and give it standing instructions (a system prompt every chat in it inherits).
- Attach documents to the project's knowledgebase; every chat in the project can ground on them.
- New chats started inside a project carry its context automatically.

Projects keep unrelated work separate and let a team share the same setup without repeating it each
time.`,
    },
    {
      slug: 'guides/prompts',
      title: 'Prompts',
      description: 'A reusable prompt library, plus what your org actually asks.',
      body: `The Prompts library keeps reusable prompt texts you can save, tag, and organize, so good
prompts are shared instead of retyped.

## What it holds

- **Saved prompts** — titled, tagged prompt texts, editable and reusable across chats.
- **Common prompts** — a view mined from what your org actually asks, surfacing patterns worth
  saving as templates.

Prompts you save are available in Chat, so anyone can start from a proven prompt rather than a blank
box.`,
    },
    {
      slug: 'guides/artifacts',
      title: 'Artifacts',
      description: 'Generated outputs you can reopen, edit live, and roll back.',
      body: `Artifacts are the generated outputs from your chats — HTML, SVG, React components,
diagrams, and code — saved so you can reopen them anytime.

## What you can do

- **Reopen** any artifact from the Artifacts library.
- **Edit in place** with a live preview that re-renders as you type.
- **Ask AI to change it** — select part of an artifact and describe the change.
- **Version and revert** — publishing a change keeps history, so you can roll back to any prior
  version.

Artifacts are stored in your own object store alongside the rest of your files.`,
    },
  ],
};
