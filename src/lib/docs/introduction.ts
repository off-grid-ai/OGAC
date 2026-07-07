import type { DocSection } from './types';

export const introductionSection: DocSection = {
  id: 'introduction',
  label: 'Introduction',
  pages: [
    {
      slug: '',
      title: 'What is Off Grid AI Console',
      description: 'Your organization’s private AI platform — models, data, and governance on your own hardware.',
      body: `Off Grid AI Console is your organization's private AI platform. You run capable models on your own
hardware, connect your own data, and put every request under your own governance. Nothing leaves
your infrastructure unless you allow it.

Most AI platforms make you choose: the frontier models, or your data staying private. Off Grid AI
removes the trade-off. The intelligence *inside* your org (your documents, systems, and knowledge)
and the intelligence *outside* it (open-weight and, when you permit it, cloud models) meet on one
control plane that you own.

![The Off Grid AI Console home — health, governance posture, spend, and activity at a glance](/docs-shots/overview.png)

## What you get

- **A private AI, everywhere.** Chat, projects, and knowledge, answered by models running on
  your own gateways. No per-seat cost, no prompts sent to a vendor.
- **Your data, made answerable.** Connect core systems, upload documents, and ask questions in plain
  language. Every answer cites the source it came from.
- **Governed by default.** Policy, PII masking, access control, and a tamper-evident audit trail sit
  in front of every request. A request only reaches a cloud model if your rules allow it; the default
  is deny.
- **One surface to run it all.** Agents, image generation, evals, cost, drift, lineage, and fleet
  management, in one console.

## Who it's for

Off Grid AI runs the AI operations for a regulated organization. It serves four people: the platform
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
      body: `This gets you from sign-in to a working, grounded answer. It assumes an Off Grid AI Console is
already deployed for your org (if not, see [Self-hosting](/docs/self-hosting/deployment)).

## 1. Sign in

Open your console (e.g. \`https://console.yourorg.com\`) and sign in with your work account. Access
is managed through your identity provider — Google, Microsoft, or Keycloak — so you use the login
you already have. No account yet? Ask your admin, or book a call from the sign-in screen.

## 2. Ask something

Open **Chat**, pick a model, and ask a question. The answer is generated on your own gateway; the
footer confirms it: *runs on your on-prem gateways, nothing leaves your network*. This is your
private AI, everywhere.

![Chat — a private, grounded answer generated on your own gateway](/docs-shots/chat.png)

## 3. Give it your knowledge

Go to **Knowledge** and upload a document (a policy PDF, an SOP, a spec). Off Grid AI chunks and indexes
it on your own hardware. Back in Chat, ask a question the document answers; the reply now cites the
source, and it won't invent facts beyond what it retrieved.

![Knowledge — upload a document and Off Grid AI indexes it on your own hardware for cited answers](/docs-shots/knowledge.png)

## 4. Build an assistant

Open **Studio → New assistant**. Describe what you want in plain language ("answer HR policy
questions and cite the policy"). Off Grid AI suggests the setup, you pick any skills, and you try it
right there. Publish it to your team.

![Studio — describe an assistant in plain language and publish it to your team](/docs-shots/studio.png)

## 5. Generate an image

In Chat, pick an image model from the model list and describe what you want. The image is rendered
on your own image gateway and saved to your storage.

That's the loop: ask, ground, build, generate, all on your infrastructure. The guides go capability
by capability from here.`,
    },
    {
      slug: 'how-to',
      title: 'How to…',
      description: 'The tasks operators do most, each in a few steps.',
      body: `A task-oriented index. Pick what you need to get done; each links to the full guide.

## Run and answer

- **Ask a grounded question.** Upload a doc in [Knowledge](/docs/guides/knowledge), turn grounding on
  in [Chat](/docs/guides/chat), ask. The reply cites the source.
- **Publish an assistant for your team.** [Studio → New assistant](/docs/guides/studio), describe it,
  pick knowledge and skills, try it, publish to your org or a shareable link.
- **Watch a run's full pipeline.** Open an [agent](/docs/guides/agents), run it, and read the
  [run trace](/docs/guides/agent-runs): policy, guard, retrieve, answer, ground, sign, stage by stage.

## Govern and prove

- **Stop customer data leaving the box.** In [Control](/docs/guides/control), add a routing rule
  \`data_class = PII → block\` and confirm cloud egress is off. Test it with the routing tester before
  you commit it.
- **Catch and mask PII.** Set the guardrails adapter to Presidio, then test a string on the
  [Guardrails](/docs/guides/guardrails) page to see the live redaction.
- **Restrict who can do what.** Add rules on the [Policy](/docs/guides/policy) page; deny wins.
- **Hand a regulator a report.** Generate a signed compliance export in
  [Regulatory](/docs/guides/regulatory); it cites the audit trail and eval evidence.
- **Answer "who did what, when."** Search the [Audit](/docs/guides/audit) ledger or filter the
  [Security events](/docs/guides/security-events) stream.

## Operate the platform

- **Add or drain a model node.** Register it in [Fleet](/docs/guides/fleet), assign a model, enable
  it; disable to drain for maintenance.
- **Check every service is healthy.** The [Services](/docs/guides/services) directory shows live,
  server-probed health for the console, gateway, and every backend.
- **Set a team's budget.** Create a virtual key and a monthly limit in [FinOps](/docs/guides/finops);
  a completion checks the budget before it runs.
- **Connect a system of record.** Add a connector in [Data](/docs/guides/data), point it at an
  endpoint, sync. Real row counts, no fabricated data.
- **Back up the control plane.** Run a backup on demand or verify the schedule in
  [Backups](/docs/guides/backups).`,
    },
    {
      slug: 'why-off-grid',
      title: 'Why Off Grid AI Console',
      description: 'Why an integrated, on-prem platform beats a pile of SaaS point tools.',
      body: `The AI-infrastructure market is a pile of point tools: one product to route model calls,
another to trace them, another to test them, another to police them, another to reach your internal
data. Each is SaaS. Each holds a copy of your prompts and often your data. Each is one more contract
and one more seam where governance leaks.

Off Grid AI Console is one platform instead of that pile, running on your own hardware.

![One control plane — routing, policy, egress, and audit search governed from a single room](/docs-shots/control.png)

## The moat is the integration

Anyone can run the individual open-source pieces. The value is that in Off Grid AI they are one product:
the gateway knows about the policy engine, the policy engine knows about the PII scanner, the
scanner's verdict lands in the same audit trail your regulator reads, retrieval respects the same
access rules as chat, and every token's cost is attributed back to the team that spent it. One
control plane, one identity model, one audit ledger.

## Built for regulated buyers

For a bank, an insurer, or a hospital, the question isn't "is the AI good" — it's "can I defend this
to my regulator." That reframes the product: governance isn't a feature added on, it's the reason
Off Grid AI exists, and it's why the platform wins where a pure developer tool can't.

## On-prem by construction

Most competitors are SaaS and structurally cannot offer true on-prem or air-gapped deployment. Off
Grid is on-prem first; cloud is the exception you gate, not the default you assume. Your data never
leaves the box unless you decide it should.`,
    },
  ],
};
