import type { DocSection } from './types';

export const introductionSection: DocSection = {
  id: 'introduction',
  label: 'Introduction',
  pages: [
    {
      slug: '',
      title: 'What is Off Grid',
      description: 'Your organization’s private AI platform — models, data, and governance on your own hardware.',
      body: `Off Grid is your organization's private AI platform. You run capable models on your own
hardware, connect your own data, and put every request under your own governance. Nothing leaves
your infrastructure unless you allow it.

Most AI platforms make you choose: the frontier models, or your data staying private. Off Grid
removes the trade-off. The intelligence *inside* your org (your documents, systems, and knowledge)
and the intelligence *outside* it (open-weight and, when you permit it, cloud models) meet on one
control plane that you own.

## What you get

- **A private ChatGPT for your org.** Chat, projects, and knowledge, answered by models running on
  your own gateways. No per-seat cost, no prompts sent to a vendor.
- **Your data, made answerable.** Connect core systems, upload documents, and ask questions in plain
  language. Every answer cites the source it came from.
- **Governed by default.** Policy, PII masking, access control, and a tamper-evident audit trail sit
  in front of every request. A request only reaches a cloud model if your rules allow it; the default
  is deny.
- **One surface to run it all.** Agents, image generation, evals, cost, drift, lineage, and fleet
  management, in one console.

## Who it's for

Off Grid runs the AI operations for a regulated organization. It serves four people: the platform
team keeping it fast and cheap, the compliance officer who has to defend it to a regulator, the
builder shipping AI features, and the finance owner watching the spend. Each gets a surface built
for their job.

## On your infrastructure

Everything runs on hardware you control, on-prem or in your own cloud. The models run on your
gateway nodes. Your documents are indexed in your own vector store. The audit log is your record.
When a request is allowed out to a cloud model, that decision is logged and attributable. This is
not a privacy promise laid over someone else's servers; it is where the software runs.

Ready to try it? Start with the [Quickstart](/docs/quickstart).`,
    },
    {
      slug: 'quickstart',
      title: 'Quickstart',
      description: 'From sign-in to your first grounded answer in a few minutes.',
      body: `This gets you from sign-in to a working, grounded answer. It assumes an Off Grid Console is
already deployed for your org (if not, see [Self-hosting](/docs/self-hosting/deployment)).

## 1. Sign in

Open your console (e.g. \`https://console.yourorg.com\`) and sign in with your work account. Access
is managed through your identity provider — Google, Microsoft, or Keycloak — so you use the login
you already have. No account yet? Ask your admin, or book a call from the sign-in screen.

## 2. Ask something

Open **Chat**, pick a model, and ask a question. The answer is generated on your own gateway; the
footer confirms it: *runs on your on-prem gateways, nothing leaves your network*. This is your
private ChatGPT.

## 3. Give it your knowledge

Go to **Knowledge** and upload a document (a policy PDF, an SOP, a spec). Off Grid chunks and indexes
it on your own hardware. Back in Chat, ask a question the document answers; the reply now cites the
source, and it won't invent facts beyond what it retrieved.

## 4. Build an assistant

Open **Studio → New assistant**. Describe what you want in plain language ("answer HR policy
questions and cite the policy"). Off Grid suggests the setup, you pick any skills, and you try it
right there. Publish it to your team.

## 5. Generate an image

In Chat, pick an image model from the model list and describe what you want. The image is rendered
on your own image gateway and saved to your storage.

That's the loop: ask, ground, build, generate, all on your infrastructure. The guides go capability
by capability from here.`,
    },
    {
      slug: 'why-off-grid',
      title: 'Why Off Grid',
      description: 'Why an integrated, on-prem platform beats a pile of SaaS point tools.',
      body: `The AI-infrastructure market is a pile of point tools: one product to route model calls,
another to trace them, another to test them, another to police them, another to reach your internal
data. Each is SaaS. Each holds a copy of your prompts and often your data. Each is one more contract
and one more seam where governance leaks.

Off Grid is one platform instead of that pile, running on your own hardware.

## The moat is the integration

Anyone can run the individual open-source pieces. The value is that in Off Grid they are one product:
the gateway knows about the policy engine, the policy engine knows about the PII scanner, the
scanner's verdict lands in the same audit trail your regulator reads, retrieval respects the same
access rules as chat, and every token's cost is attributed back to the team that spent it. One
control plane, one identity model, one audit ledger.

## Built for regulated buyers

For a bank, an insurer, or a hospital, the question isn't "is the AI good" — it's "can I defend this
to my regulator." That reframes the product: governance isn't a feature added on, it's the reason
Off Grid exists, and it's why the platform wins where a pure developer tool can't.

## On-prem by construction

Most competitors are SaaS and structurally cannot offer true on-prem or air-gapped deployment. Off
Grid is on-prem first; cloud is the exception you gate, not the default you assume. Your data never
leaves the box unless you decide it should.`,
    },
  ],
};
