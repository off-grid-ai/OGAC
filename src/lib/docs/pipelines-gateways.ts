import type { DocSection } from './types';

// Pipelines & gateways — the governance spine every model call runs through. A gateway is a model
// backend; a pipeline is the reusable, governed way to call it; apps/agents/chat consume a pipeline.
// Copy follows brand/: outcomes first, speak to "you", Indian BFSI framing, no engine names.
export const pipelinesGatewaysSection: DocSection = {
  id: 'pipelines-gateways',
  label: 'Pipelines & gateways',
  pages: [
    {
      slug: 'guides/gateways',
      title: 'Gateways',
      description: 'The model backends your pipelines run on — on your own hardware, or cloud when you allow it.',
      body: `A gateway is a model backend: a place your requests go to be answered. It might be your own
on-prem cluster, or a cloud provider you have chosen to allow. Your pipelines run *on* a gateway, so
adding one is how you decide which models your organization can reach at all.

![The Gateways surface — every model backend your pipelines can run on, with honest health and egress](/docs-shots/gateways-list.png)

## Why it matters

The gateway is the one place model traffic flows through, so it is the one place you control where
answers are generated and whether your data ever leaves the building. A gateway carries an **egress
class** you can read at a glance: *data stays on-prem* (your own nodes) or *data leaves (cloud)*. That
label is what your pipelines' routing leash keys off — a request tagged as sensitive can be kept on a
"stays on-prem" gateway no matter who asks.

## How to use it

Open **Gateways** from the sidebar. You get a card per backend showing its kind, egress class, default
model, whether it is enabled, and its live health.

- **Add a gateway** — click **Add gateway**, then give it a name, a kind (on-prem cluster, OpenAI,
  Anthropic, or an OpenAI-compatible provider), a base URL, and a default model. Cloud kinds need a
  provider key, held in the [secrets](/docs/guides/secrets) vault, never in the record itself.
- **Edit or disable** — open a gateway to change its endpoint, model, or credentials, or flip
  **Enabled** off to take it out of rotation without deleting it. A disabled gateway can't be picked by
  a pipeline.
- **Read the model catalog** — the detail page shows the published spec (context window, modality) for
  a known model. If a model isn't in the curated catalog, you'll see *spec unknown* rather than a
  guessed number — the console never invents a spec.

![A gateway detail — endpoint, egress, model catalog, and the pipelines running on it](/docs-shots/gateway-detail.png)

## When to use it

Add a gateway when you stand up a new model cluster, bring on a new region of nodes, or decide to
allow a specific cloud provider for the use-cases your policy permits. A bank running KYC and loan
work entirely on-prem might keep only its on-prem cluster enabled; a team allowed to use a cloud model
for non-sensitive summarization would add and enable that provider, with the egress leash on its
pipelines keeping customer data off it.

## How to check it worked

- The new gateway appears on the **Gateways** list with an honest **health** read: *available*, or
  *degraded* with a node count (for example, "5 of 6 nodes up"), or *not configured* if it still needs
  a key. Health is probed live, not asserted.
- Open the gateway and confirm the **egress** badge reads what you intend (*data stays on-prem* vs
  *data leaves (cloud)*).
- The **Pipelines running on this gateway** panel lists every pipeline bound to it — proof it is now a
  backend your pipelines can pick.`,
    },
    {
      slug: 'guides/pipelines',
      title: 'Pipelines',
      description: 'The reusable, governed way to call models — a data ceiling, policy, guardrails, and a quality bar in one contract.',
      body: `A pipeline is the heart of Off Grid AI: a reusable, governed way to call models. It binds a
gateway, sets how requests route, fixes a hard limit on the data it may ever touch, and layers your
policy, guardrails, and quality checks on top. Your apps, agents, and chat don't call a model
directly — they consume a pipeline, and inherit every control it carries. Set the rules once, reuse
them everywhere.

![The Pipelines surface — reusable, governed model-access contracts, each bound to a gateway with a data ceiling](/docs-shots/pipelines-list.png)

## Why it matters

Without a pipeline, every app is its own snowflake and governance is a promise. With one, a request
for a loan decision and a request for a fraud score can share the same evaluated, policy-wrapped
contract — or each have their own, tightened to exactly what it needs. Because the pipeline is the
chokepoint every model call passes through, it is also where you *see* everything: quality, drift,
cost, and a full audit of who called what.

## Create and publish one

Open **Pipelines** and click **New pipeline**. Give it a name and description, choose the gateway it
**Runs on**, and pick its default model. A new pipeline starts as a **draft**; when it's ready,
**publish** it so consumers can bind it. Editing a published pipeline creates a new **version** — so a
change is deliberate and reviewable, and a consumer keeps running the version it pinned until you move
it.

## The tabs, and what each is for

Open any pipeline to a detail view with a tab per concern. Each tab is a surface you *operate*, not a
read-only chart.

- **Overview** — the whole contract at a glance: its gateway, routing, data ceiling, policy and
  guardrail posture, quality, and its consumers. Start here.
- **Gateway & Routing** — which gateway and model it runs on, plus the routing leash: a fallback model
  and the egress rule (for example, *sensitive data → keep local*). Good means the leash matches the
  data class the pipeline is allowed to touch.
- **Policy** — the effective access rules: your org defaults with this pipeline's overrides on top.
  Controls your org has **locked** can only be *tightened* here, never loosened — the badge tells you
  which is which. Every request through the pipeline is checked against the value shown.
- **Guardrails** — the PII and injection checks that scan each prompt and answer. Tighten them beyond
  the org default when a pipeline handles more sensitive data.
- **Quality** — the [evals](/docs/guides/evals) and golden set that belong to this pipeline. A passing
  run means *this* pipeline meets the bar, and gates its releases. Attach an eval from the library, or
  add golden cases (a question plus the answer it must get right).
- **Drift** — how quality moves over this pipeline's own history, so a slow slide shows up before a
  user complains.
- **Observability** — traces for the pipeline's requests: latency, tokens, and each stage of the run.
- **Audit** — the tamper-evident record of every call through it, with the policy and guardrail
  decisions and whether data left the box.
- **Cost** — this pipeline's slice of spend, attributed to its gateway and model. Requests, tokens,
  and cost, keyed to the pipeline.
- **API** — mint a key and get the endpoint to call the pipeline from outside (see
  [Binding & consuming a pipeline](/docs/guides/pipeline-binding)).
- **Versions** — the immutable history; roll a consumer forward when you're ready.

## The data ceiling is a hard limit

![A pipeline's Policy tab — org-locked controls that a pipeline may only tighten, never loosen](/docs-shots/pipeline-policy.png)

A pipeline's data allowlist is a **hard ceiling**: an app or agent bound to it can only ever touch data
inside that allowlist. To let a use-case reach more data, you widen the pipeline (a new version) or
bind a different one — there is no per-app back door. This is what makes a pipeline safe to reuse: the
contract can only get tighter downstream, never looser.

## When to use it

Build a pipeline whenever you have a governed way of calling models you want to reuse or prove. For a
bank: a **KYC Verification** pipeline that may read the PAN and address domains and must stay on-prem;
a **Loan Underwriting** pipeline that may read the applicant profile and bureau data; a **Fraud
Screening** pipeline over transaction data. One pipeline per app or per department is perfectly fine —
the pipeline is a hygiene unit, not a forced-sharing one.

## How to check it worked

- The pipeline shows as **published** on the list and its **Overview** reflects the gateway, model,
  data ceiling, and policy you set.
- On **Quality**, an attached eval appears under "Evals for this pipeline"; run it and a passing result
  is the in-product signal that the pipeline meets its bar.
- On **Cost** and **Observability**, once real traffic flows through it, requests and spend appear
  keyed to the pipeline — honest empty states until then, never a fabricated number.`,
    },
    {
      slug: 'guides/pipeline-binding',
      title: 'Binding & consuming a pipeline',
      description: 'How apps, agents, and chat pick a pipeline — and how to call one over the API.',
      body: `A pipeline is only useful once something consumes it. Apps and agents **bind** a pipeline as
their "Runs on"; chat and projects bind one too; and an external system can call a pipeline directly
over its own provisioned API. Every one of these inherits the pipeline's gateway, data ceiling,
policy, guardrails, and audit — there is no ungoverned path to a model.

## Apps and agents: "Runs on"

In the builder, every app and agent has a **Runs on** selector — the pipeline it consumes. Pick one,
and every run the app makes is a governed run on that pipeline: checked against its policy, masked by
its guardrails, kept inside its data ceiling, and recorded in its audit and cost.

You can confirm the binding from the other side: open the pipeline and look at the **Consumers**
section on its Overview — every app and agent bound to it is listed there.

![A pipeline's Overview — the Consumers section lists every app, agent, and chat bound to it](/docs-shots/pipeline-overview.png)

## Chat and projects

Chat is not special — it binds a pipeline like any other consumer, so every message is a governed run.
Binding follows the most-specific-wins rule:

- **Admins set the org default** — a "Workspace Chat" pipeline everyone gets, plus the *set of
  pipelines available* for chat.
- **Users pick per project** — inside a project, a user chooses among the available pipelines; the
  project's choice applies to chats in it.
- **Per-message model** — a user can switch models *within* the bound pipeline's gateway, but never
  escapes the pipeline.

No user can invent an ungoverned binding: the choices are always a subset of what an admin allowed.

## External systems: the pipeline API

To call a pipeline from outside the console — a batch job, another service, a partner — mint a key on
the pipeline's **API** tab and use the endpoint shown.

![A pipeline's API tab — the endpoint, a ready-to-run request, and the keys that can call it](/docs-shots/pipeline-api.png)

- **Mint a key** — the plaintext key (prefixed \`og_pl_\`) is shown **once**, at mint time. Copy it
  then; the console only ever stores and lists a prefix afterwards, so it can't leak the secret later.
- **Call the endpoint** — the API tab gives you the exact request to make. Every call runs the
  pipeline's full governance, so an external caller is held to the same rules as an internal app.
- **Revoke** — retire a key from the same table the moment it's no longer needed; the prefix stays for
  the audit trail.

## Why it matters

Binding is what turns "a governed pipeline" into "a governed organization." A risk officer can point at
a single pipeline and see every consumer — the loan app, the fraud agent, the KYC batch job, the chat
project — all held to one contract, all in one audit trail.

## How to check it worked

- In the builder, the app or agent's **Runs on** shows the pipeline you picked.
- On the pipeline's **Overview**, the bound app, agent, or chat appears under **Consumers**.
- For an API caller, a request with the minted key succeeds and shows up on the pipeline's **Audit**
  and **Cost** tabs, keyed to the pipeline — the proof the call was governed, not a side door.`,
    },
  ],
};
