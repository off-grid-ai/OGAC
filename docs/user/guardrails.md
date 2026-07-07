# Guardrails

*Documented + verified 2026-07-07.* Surface: **Governance → Guardrails (`/guardrails`)**.

## What it is

The safety net that inspects text on the way into a model and on the way back out — catching and
redacting personal or sensitive information (emails, phone numbers, card numbers, national IDs, and
more), and holding the line on other content checks. You turn protections on here; the platform
applies them on every request, and a live tester lets you see exactly what would happen to a given
string.

## Why use it

- Sensitive data (PII/PHI) is caught and **redacted or masked before it ever reaches a model or a
  user** — the difference between "we have a policy" and "the policy is enforced on every message."
- A basic set of protections is **always on** even if the advanced detector is down, so you're never
  running unprotected.
- You can prove to an auditor exactly which entities you detect and how you treat each one, and test
  a real string to demonstrate it.

## When to use it

- Standing up the platform: switch on the standard protections for the data you handle.
- Tightening controls: add a custom recognizer for an internal ID format, a deny-list of terms, or a
  stricter confidence threshold.
- Investigating: a run was blocked or redacted and you need to see the rule that fired, or you want
  to confirm a new pattern catches what you expect.

## How to use it

The page opens with engine status, then the protection catalog, then the rule managers, then a live
tester.

### Read the engine status

The **Engine** card shows the active detection engine and whether it's **reachable** (green) or
**unreachable** (red); a **not configured** tag appears if the advanced engine isn't set up. The
**Supported entity types** card lists exactly what it can detect (e.g. `EMAIL_ADDRESS`,
`PHONE_NUMBER`, `PERSON`, `CREDIT_CARD`, `US_SSN`, `IBAN_CODE`, `IP_ADDRESS`). If the engine is
unreachable, an always-on regex floor still catches the common cases (emails, phone numbers).

### Turn on standard protections (the catalog)

**Turn on standard protections** is a searchable, filterable catalog of ready-made protections,
grouped by category (Identity, Financial, Contact, Network, Medical, Government & Country, Content
Safety, Prompt Security, Output Quality). Each card carries an honest availability badge:

- **ready** — the engine is up and this protection is fully live.
- **regex floor** — the advanced engine is down, but the built-in floor still catches this one.
- **stored — engine off** — the rule is saved but waits for its engine to come online before it acts.

Click **Enable** on a card to switch it on; recommended protections are tagged.

### Manage masking rules

**Masking rules** is the CRUD table for how detected entities are treated. **Add rule** opens a
form: Matcher (an entity type or a regex), Pattern, Action (**redact / mask / hash / allow**), and
an optional Label ("why this rule exists"). Edit via the pencil icon, delete via the trash icon
(confirm prompt), and flip the per-row switch to enable/disable it live. Empty state: *"No rules yet
— the always-on regex floor still applies."*

### Custom recognizers & deny lists

**Custom recognizers & deny lists** lets you teach the detector new things. **Add recognizer**: pick
a Kind (**pattern** or **deny_list**), an Entity type, and either a Regex + context words, or a list
of deny-list terms, plus a Confidence score slider. Edit, delete (confirm), and toggle per row. This
is where an internal account-number format or a list of sensitive project names becomes detectable.

### Confidence thresholds

**Confidence thresholds** sets how sure the detector must be before it acts — a **Global floor**
slider plus optional **per-entity overrides** (add a row per entity). **Save thresholds** applies
them. Raise a threshold to cut false positives; lower it to catch more.

### Test a string (the live check)

**Test a string** runs your text through the **live active engine** — your custom recognizers, deny
lists, and thresholds all apply — and shows the result: a **PII detected / no PII** badge, which
engine judged it, the entities found, and the redacted output. Read-only; nothing is stored. This is
your "does my new rule actually work" button.

## How to check it's working

- The **Engine** card badge reads **reachable** with no **not configured** tag, and the **Supported
  entity types** card lists a full set (not just the two regex-floor fallbacks). As of 2026-07-07 on
  the live fleet the advanced engine (Microsoft Presidio) is reachable and configured, reporting 10
  entity types — this surface is working end-to-end.
- The honest end-to-end proof is **Test a string**: paste `email me at jane@acme.com or call
  +1 202 555 0143`. A working engine returns **PII detected**, names the entities (e.g.
  `EMAIL_ADDRESS`, `PHONE_NUMBER`), and shows the redacted text. If it says *"via regex floor"*
  instead of the named engine, the advanced detector is down and you're on the fallback — the page
  will also flag the engine as unreachable.
- After enabling a catalog protection or adding a recognizer, re-run the tester with a matching
  string and confirm it's now caught. Catalog cards showing **stored — engine off** are saved intent
  that won't act until the engine is online — an honest "not live yet" tag, not a silent failure.

See `docs/HOWTO.md` for step-by-step recipes that touch this surface, and `/docs/api` for the API contract.
