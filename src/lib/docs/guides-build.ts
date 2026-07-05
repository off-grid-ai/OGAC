import type { DocSection } from './types';

export const buildSection: DocSection = {
  id: 'build',
  label: 'Build with AI',
  pages: [
    {
      slug: 'guides/chat',
      title: 'Chat',
      description: 'Your private ChatGPT — grounded, governed, and answered on your own hardware.',
      body: `Chat is your org's private assistant. It streams from your own gateways, so prompts and
answers stay on your network.

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
