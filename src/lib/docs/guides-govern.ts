import type { DocSection } from './types';

export const governSection: DocSection = {
  id: 'govern',
  label: 'Govern & comply',
  pages: [
    {
      slug: 'guides/governance',
      title: 'Governance overview',
      description: 'Set the org\'s rules once - everyone builds inside them.',
      body: `**What you'll get:** you define the org's rules once - policy, guardrails, egress, audit -
and every request everyone makes inherits them automatically. Governance isn't a feature bolted on;
it is the path every request takes. Each piece below is a surface you operate, not a dashboard you
watch.

![Governance in one place - policy, guardrails, egress, and audit search you operate, not just watch](/docs-shots/control.png)

- **[Control](/docs/guides/control)** - the control room: egress, routing, policy, users, audit search.
- **[Policy](/docs/guides/policy)** - attribute-based access, deny by default.
- **[Guardrails](/docs/guides/guardrails)** - PII detection and masking on every prompt.
- **[Access](/docs/guides/access)** - one identity model across every surface.
- **[Secrets](/docs/guides/secrets)** - credentials and keys in a vault.
- **[Audit](/docs/guides/audit)** - a tamper-evident record of every completion.
- **[Lineage](/docs/guides/lineage)** - trace an answer back to its sources.
- **[Provenance](/docs/guides/provenance)** - sign answers and reports so they're verifiable.
- **[Regulatory](/docs/guides/regulatory)** - a governance registry and compliance exports.

## The audit trail

Every completion records the model, tokens, whether data left the box, which guardrails fired with
what verdict, latency, and the cost key. This is the artifact you hand a regulator: not a claim that
the AI is controlled, but the evidence.`,
    },
    {
      slug: 'guides/control',
      title: 'Control center',
      description: 'The governance control room - egress, routing, policy, users, secrets, and audit search in one place.',
      body: `Control is the room a risk officer runs the platform from. It gathers the governance levers
that decide what the platform is allowed to do, so you can set the posture and prove it in one place.

![The Control center - egress leash, routing, policy, and audit search in one room](/docs-shots/control.png)

## The egress leash

The master switch. Cloud egress ON or OFF decides whether any request can reach a cloud model. With
it off, a \`cloud\` routing rule is forced to block - sensitive data can't route to a cloud model,
whatever anyone asks. The live state is shown here.

## Routing rules

Add, edit, enable/disable, and reorder the rules that decide where each request runs (local, cloud,
or block), by data class and priority. The **routing tester** lets you check any request against your
rules before you commit them, so you never guess at what a rule will do.

## Policy, users, and secrets

The same surface exposes the [policy](/docs/guides/policy) editor, [users and roles](/docs/guides/access),
and the [secrets](/docs/guides/secrets) vault panel - the levers you reach for together when you're
setting or auditing the org's posture.

## Audit search

Full-text search across the audit stream lives here: find every event for an actor, a run, or an
outcome. It's the fastest path from "did this happen" to the evidence.`,
    },
    {
      slug: 'guides/policy',
      title: 'Policy',
      description: 'Attribute-based access control, deny by default, with policy-as-code.',
      body: `Policy decides who and what is allowed. It runs on every request, before anything else.

![Policy - attribute-based rules, deny by default, as code](/docs-shots/policy.png)

## Rules

A policy rule matches on an attribute (role, data class, resource) with an operator (equals, not-
equals, in) and an effect (allow or deny). Deny overrides: a matching deny wins. With no matching
rule, the safe default applies.

## Manage it

On the **Policy** page, create, edit, enable/disable, and delete rules, each with a priority. Changes
take effect on the next request.

## First-party or policy-as-code

The console ships a built-in attribute-based engine. For policy-as-code at scale, point the policy
adapter at an external policy engine and author rules there; the console falls back to the built-in
engine if that engine is unreachable, so turning it on is never a hard dependency.

## What success looks like

You add a deny rule, and the very next request that matches it is refused - visible as a denied
outcome in the [audit ledger](/docs/guides/audit). One rule, enforced everywhere, with no per-app
wiring.`,
    },
    {
      slug: 'guides/guardrails',
      title: 'Guardrails & PII',
      description: 'Detect and mask sensitive data on every prompt and answer.',
      body: `Guardrails scan every prompt before it moves and every answer before it leaves.

![Guardrails - PII detection and masking on every prompt and answer](/docs-shots/guardrails.png)

## Two layers

- **Regex floor** - always on. Detects and redacts common PII (email, phone, card, SSN-like
  patterns). It's the safety net that can never be turned off.
- **Entity-grade detection** - the production detector. When configured, it does entity-grade
  detection and masks the matched spans. If it's unreachable, guardrails degrade to the regex floor -
  they never fail open.

## Test it

On the **Guardrails** page, type a string into the test box and see exactly what the active engine
detects and how it redacts - the live engine, not a demo. Manage masking rules (redact, replace,
encrypt) there too.

## In the pipeline

A blocked verdict on input refuses the request; a redaction rewrites it. Output is scanned before it
leaves and recorded in the audit trail. Every verdict is logged against the request.

## What success looks like

You paste a string with an email and a card number into the test box and watch the active detector
mask them in place - then every prompt and answer across the platform gets the same treatment,
because guardrails run in the pipeline everyone shares.`,
    },
    {
      slug: 'guides/access',
      title: 'Access & identity',
      description: 'Users, roles, and machine clients through your identity provider.',
      body: `Access is one identity model across every surface, backed by your identity provider.

![Access - users, roles, machine clients, and sessions under one identity model](/docs-shots/access.png)

## Users & roles

Manage users and their roles from the **Access** page. Roles map to module capabilities, so a role
grants exactly the surfaces and actions it should. Built-in roles cover common cases; custom roles
grant a specific capability set.

## Machine clients

For programmatic access, create a **machine client** - a service account that issues a bearer token
via the client-credentials grant. Scope it to specific services so its token carries only the access
it needs. Rotate its secret from the same surface.

## Single sign-on

Providers activate from configuration: Google, Microsoft Entra, or your own SSO. Users sign in with
the login they already have; the browser never leaves the console.

## Realm administration

The deep identity controls that usually live in your identity provider's admin console are surfaced
here, so you run identity from one place instead of two:

- **Sessions** - see every active session for a user (client, IP, last access) and revoke one, or all
  of them, to sign someone out everywhere on the spot.
- **MFA** - read whether a user has an authenticator (OTP), a password, or a passkey set, and require
  them to enrol MFA at next login.
- **Required actions** - queue what a user must do before they can proceed (verify email, update
  password, configure OTP), so a lapsed control self-heals at the next sign-in.
- **Federation (IdP)** - connect an external OIDC identity provider and review the ones already
  federated, so a partner or parent org's login flows straight in.
- **Realm lifetimes** - set token and session durations (access-token lifespan, SSO idle and max
  lifetimes, offline-session idle, action-token lifespan), so how long a login stays valid is your
  policy, not a default.

These write straight through to your identity provider's realm via a service account granted realm
administration rights, so a change here is a change in the identity provider itself.`,
    },
    {
      slug: 'guides/secrets',
      title: 'Secrets',
      description: 'Connector credentials and signing keys in a vault, not in code.',
      body: `Secrets keeps sensitive values - connector credentials, virtual-key secrets, signing keys -
out of code and configuration.

![Secrets - connector credentials and signing keys held in a vault, write-only from the console](/docs-shots/secrets.png)

## How it works

For production, point the secrets adapter at your **secrets store**; the console reads and writes
through it, and falls back to the process environment if the store is unreachable, so nothing breaks.

## Manage it

On the **Secrets** page, write, list, and remove secrets. Values are write-only from the console -
only key names are listed back, never the values - so the surface can't leak what it stores.

## What success looks like

You write a connector credential and see only its key name listed back, never the value - and a
connector using it works without the secret ever appearing in code or config.`,
    },
    {
      slug: 'guides/provenance',
      title: 'Provenance',
      description: 'Sign answers and reports so they\'re verifiable, tamper-evident, and yours.',
      body: `Provenance makes an output verifiable after the fact: you can prove what was produced, by
whom, and that it wasn't altered.

![Provenance - signed, tamper-evident answers and reports](/docs-shots/provenance.png)

## What gets signed

Agent-run answers and exported reports carry a signature. Verification is standalone - anyone with
the public key can check it, offline, long after the fact.

## Signing options

- **Shared-key signature** - a tamper-evident signature over the payload, checked with a shared key.
  The default, no extra setup.
- **Identity-bound signing** - keyless signing tied to a verified identity, checkable against a
  public transparency log for the strongest chain of custody.
- **Content credentials** - for images, a credential travels with the file, so its origin follows it
  wherever it goes.

On the **Provenance** page, verify a signed artifact and see its manifest.

## What success looks like

You export a report, then verify it on the Provenance page - it confirms who produced it and that
it hasn't changed since. Hand that report to an auditor and they can check it themselves, offline.`,
    },
    {
      slug: 'guides/regulatory',
      title: 'Regulatory',
      description: 'A governance registry and one-click compliance exports.',
      body: `Regulatory is the org-level wrapper around the technical controls - the record a DPO or
compliance officer maintains.

![Regulatory - a governance registry and signed, one-click compliance exports](/docs-shots/regulatory.png)

## The governance registry

Track governance items: policy attestations, ethics reviews, RACI assignments, training, vendor
reviews, impact assessments, and drills. Each has an owner, a status, and a review date, so nothing
lapses silently.

## Compliance exports

Generate a report that maps your controls to a framework and cites the underlying evidence - the
audit trail, the eval results, the governance items. The export carries a provenance signature, so
what you hand a regulator is verifiable.`,
    },
  ],
};
