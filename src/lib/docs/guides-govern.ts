import type { DocSection } from './types';

export const governSection: DocSection = {
  id: 'govern',
  label: 'Govern & comply',
  pages: [
    {
      slug: 'guides/governance',
      title: 'Governance overview',
      description: 'Prove to a regulator that your AI is controlled.',
      body: `Governance is why regulated organizations choose Off Grid. It isn't a feature bolted on;
it is the path every request takes. Each piece below is a surface you operate, not a dashboard you
watch.

- **[Policy](/docs/guides/policy)** — attribute-based access, deny by default.
- **[Guardrails](/docs/guides/guardrails)** — PII detection and masking on every prompt.
- **[Access](/docs/guides/access)** — one identity model across every surface.
- **[Secrets](/docs/guides/secrets)** — credentials and keys in a vault.
- **Audit** — a tamper-evident record of every completion (see [Security events](/docs/guides/security-events)).
- **[Provenance](/docs/guides/provenance)** — sign answers and reports so they're verifiable.
- **[Regulatory](/docs/guides/regulatory)** — a governance registry and compliance exports.

## The audit trail

Every completion records the model, tokens, whether data left the box, which guardrails fired with
what verdict, latency, and the cost key. This is the artifact you hand a regulator: not a claim that
the AI is controlled, but the evidence.`,
    },
    {
      slug: 'guides/policy',
      title: 'Policy',
      description: 'Attribute-based access control, deny by default, with policy-as-code.',
      body: `Policy decides who and what is allowed. It runs on every request, before anything else.

## Rules

A policy rule matches on an attribute (role, data class, resource) with an operator (equals, not-
equals, in) and an effect (allow or deny). Deny overrides: a matching deny wins. With no matching
rule, the safe default applies.

## Manage it

On the **Policy** page, create, edit, enable/disable, and delete rules, each with a priority. Changes
take effect on the next request.

## First-party or OPA

The console ships a first-party attribute-based engine. For policy-as-code at scale, set the policy
adapter to **OPA** and author rules in Rego; the console falls back to the first-party engine if OPA
is unreachable, so turning it on is never a hard dependency.`,
    },
    {
      slug: 'guides/guardrails',
      title: 'Guardrails & PII',
      description: 'Detect and mask sensitive data on every prompt and answer.',
      body: `Guardrails scan every prompt before it moves and every answer before it leaves.

## Two layers

- **Regex floor** — always on. Detects and redacts common PII (email, phone, card, SSN-like
  patterns). It's the safety net that can never be turned off.
- **Presidio** — the production detector. When configured, it does entity-grade detection and calls
  the anonymizer to mask spans. If Presidio is unreachable, guardrails degrade to the regex floor —
  they never fail open.

## Test it

On the **Guardrails** page, type a string into the test box and see exactly what the active engine
detects and how it redacts — the live engine, not a demo. Manage masking rules (redact, replace,
encrypt) there too.

## In the pipeline

A blocked verdict on input refuses the request; a redaction rewrites it. Output is scanned before it
leaves and recorded in the audit trail. Every verdict is logged against the request.`,
    },
    {
      slug: 'guides/access',
      title: 'Access & identity',
      description: 'Users, roles, and machine clients through your identity provider.',
      body: `Access is one identity model across every surface, backed by Keycloak.

## Users & roles

Manage users and their roles from the **Access** page. Roles map to module capabilities, so a role
grants exactly the surfaces and actions it should. Built-in roles cover common cases; custom roles
grant a specific capability set.

## Machine clients

For programmatic access, create a **machine client** — a service account that issues a bearer token
via the client-credentials grant. Scope it to specific services so its token carries only the access
it needs. Rotate its secret from the same surface.

## Single sign-on

Providers activate from configuration: Google, Microsoft Entra, or Keycloak. Users sign in with the
login they already have; the browser never leaves the console.`,
    },
    {
      slug: 'guides/secrets',
      title: 'Secrets',
      description: 'Connector credentials and signing keys in a vault, not in code.',
      body: `Secrets keeps sensitive values — connector credentials, virtual-key secrets, signing keys —
out of code and configuration.

## How it works

The default store is the process environment. For production, set the secrets adapter to **OpenBao**
(a KV v2 vault); the console reads and writes through it, and falls back to env if it's down.

## Manage it

On the **Secrets** page, write, list, and remove secrets. Values are write-only from the console —
only key names are listed back, never the values — so the surface can't leak what it stores.`,
    },
    {
      slug: 'guides/provenance',
      title: 'Provenance',
      description: 'Sign answers and reports so they’re verifiable, tamper-evident, and yours.',
      body: `Provenance makes an output verifiable after the fact: you can prove what was produced, by
whom, and that it wasn't altered.

## What gets signed

Agent-run answers and exported reports carry a signature. Verification is standalone — anyone with
the public key can check it, offline.

## Signing options

- **First-party** — an HMAC signature over the payload, tamper-evident with a shared key.
- **Sigstore** — keyless signing tied to an OIDC identity, verifiable against the public transparency
  log.
- **C2PA** — content credentials for images: a detached manifest travels with the file.

On the **Provenance** page, verify a signed artifact and see its manifest.`,
    },
    {
      slug: 'guides/regulatory',
      title: 'Regulatory',
      description: 'A governance registry and one-click compliance exports.',
      body: `Regulatory is the org-level wrapper around the technical controls — the record a DPO or
compliance officer maintains.

## The governance registry

Track governance items: policy attestations, ethics reviews, RACI assignments, training, vendor
reviews, impact assessments, and drills. Each has an owner, a status, and a review date, so nothing
lapses silently.

## Compliance exports

Generate a report that maps your controls to a framework and cites the underlying evidence — the
audit trail, the eval results, the governance items. The export carries a provenance signature, so
what you hand a regulator is verifiable.`,
    },
  ],
};
