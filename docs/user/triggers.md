# Triggers — how an app gets started

Status: ✅ fully documented (post-builder-epic sweep, 2026-07-06)

**What it is** — A trigger is how a run of your app begins. You pick one when you build the app.

**Why use it** — Most governed processes shouldn't wait for someone to click "Run". A trigger lets
an app fire on an inbound event (a webhook), on a schedule, or from a person's request.

**When to use which:**

| Trigger | Fires when | Availability |
|---|---|---|
| **On demand** | a person runs it from the Input form | always |
| **Webhook** | an inbound HTTP POST hits the app's run URL | always |
| **Schedule** | a recurring cron time is reached | always |
| **Email** | an email arrives at a watched inbox | on-prem only (fail-closed) |
| **WhatsApp** | a message arrives at your on-prem gateway | on-prem only (fail-closed) |

## Webhook

A published app exposes `POST /api/v1/app/<slug>/run`. It is **governed, not wide open**:

- You must authenticate with **either** a webhook token (`X-Webhook-Token` header or `?token=`,
  matching `OFFGRID_WEBHOOK_TOKEN`) **or** a verified principal (service-account JWT, admin token, or
  console session). Neither → `401`.
- The inbound JSON body is normalized to the app's run input, then funneled through the **same
  governed entry point** every run uses — policy, guardrails, grounding and provenance signing all
  apply. There is no governance bypass.
- The app must exist and be **published**.

## Email & WhatsApp (on-prem only, fail-closed)

These are **disabled unless you explicitly configure an on-prem endpoint** — they never reach out to
a cloud service, and they fail *closed* (stay off) when unconfigured:

- **Email** requires `OFFGRID_EMAIL_IMAP_URL` plus `OFFGRID_EMAIL_IMAP_USER` /
  `OFFGRID_EMAIL_IMAP_PASS`. Without them the trigger reports "disabled — set OFFGRID_EMAIL_IMAP_URL
  …" and does nothing.
- **WhatsApp** requires `OFFGRID_WHATSAPP_URL` (an on-prem gateway URL). Without it the trigger
  reports disabled and does nothing.
- When configured, both normalize the inbound message and funnel through the same governed entry
  point as the webhook — full policy/guardrails/grounding, no bypass.

In the builder these two show as "coming soon / on-prem" until their env is present on the fleet.

## Durable vs inline (matters for human-in-the-loop)

When a trigger fires, the platform decides how to execute:
- A single-step app runs **inline**.
- A multi-step app or one with a **human** step needs the **durable** runtime (Temporal, the
  `offgrid-apps` queue). If the durable runtime is enabled and reachable, the run is submitted there
  and can pause/resume at human steps; if not, it degrades to an inline run (which stops at the first
  human pause and cannot be resumed). See `app-builder.md` → "human-in-the-loop caveat".
