# Fleet

*Documented + verified 2026-07-07.* Surface: **Gateway & Fleet → Fleet (`/fleet`)**.

## What it is

The register of the **end-user devices** that run against your platform — laptops, phones, field
machines — how they get on (enrollment), what policy they run, whether they've checked in lately, and
the one button that takes a lost or compromised one off the board: the **kill switch**.

Every device carries its own credential, converges to your current org policy on its own, and reports
back each time it pulls policy, pushes its activity, or checks for commands. Fleet is where you see
that happening and act on it.

> Not to be confused with the **model pool** on the [AI Gateway](model-routing.md) page — those are
> *your* server machines that answer AI requests. Fleet is the *user* devices out in the world.

## Why use it

- **Know exactly what's out there.** One list of every enrolled device, its OS, role, the policy
  version it's running, and when it last checked in. No spreadsheet, no guessing.
- **Onboard without handing out shared secrets.** Enrollment is a **one-time token**: you issue it
  for a role, the device redeems it once and mints its *own* private credential. There's no long-lived
  shared key to leak.
- **Every device runs the same rules, automatically.** Push a new policy version once and devices
  converge to it on their next check-in — you don't chase each one.
- **Instant response to a lost device.** The **kill switch** queues a hard stop that the device
  executes the next time it polls. It's a decisive, audited action.

## When to use it

- **Onboarding** a new laptop/phone → issue an enrollment token.
- **A device is lost, stolen, or compromised** → kill switch, immediately.
- **After pushing a new policy** → watch devices pick up the new version as they check in.
- **A routine audit** → confirm every device on the list is one you expect, still checking in, and on
  the current policy.

## How to use it

Open **Fleet**. The top band shows four counts: **Devices** (total), **Online** (online / total),
**Policy version** (the current org policy the fleet converges to), and **Audit events**. Below that,
a badge names the device backend in use, and the **Devices** table lists each device with columns:
**Device** (click to open its detail page at `/fleet/{id}`), **OS**, **Role**, **Status**
(online/offline), **Last seen**, **Policy** (the version it's on), and an **Actions** menu.

### Enroll a device

1. Click **Enroll device**. A panel opens (it's a real place — Back closes it).
2. Enter the **Role** the device will have (e.g. "Field Advisor").
3. Click **Issue token**. The console shows a **one-time token** (`enr_…`) with a **Copy** button.
   *Copy it now — it's shown once and can be redeemed only once.*
4. On the device, the Off Grid client redeems that token. In return it receives its own private
   device credential and appears in the table as **online**, on the current policy version.

That device credential is minted per-device and returned only at enrollment — the console never shows
it again. From then on the device authenticates with it on every call.

### Assign / update policy

There's no per-device policy picker — and that's the point. **Policy is org-wide**, and every device
**converges** to the current version on its next check-in. You change policy in
[Policy](policy.md) (which bumps the version); the fleet's **Policy version** count and each device's
**Policy** column then tick up to the new version as devices pull it. This is the honest model: you
manage one policy, not N device configs.

### Kill switch

In a device's **Actions** menu, choose the kill action. You'll confirm — *"Send the kill switch to
'{name}'? The node executes it on next poll."* The console queues the command; the device executes it
the next time it polls (it doesn't require the device to be reachable *right now*). The action is
written to the **Audit Log** as `device.kill`.

### Device management commands (lock / unlock / wipe / refetch)

These heavier MDM actions — **Lock**, **Unlock** (returns an unlock PIN), **Wipe** (erases the device,
cannot be undone), **Refetch** (re-collect the device's vitals) — appear in the Actions menu **only
when a full device-management backend is connected**. On the built-in device registry they are not
offered, and the related surfaces (host software inventory, live queries, compliance policies) report
themselves as **needing that backend** rather than faking a result.

> **Honest status (verified 2026-07-07):** enrollment, policy convergence, check-in, and the kill
> switch are fully built and working end-to-end. The device-management extras (lock/unlock/wipe/
> live-query/host-policies) are **not active on this deployment** — that backend isn't configured, so
> those routes return a clear *"requires a device-management backend"* rather than a result. And on
> the live server the **device list is currently empty** — no end-user devices are enrolled yet
> (rolling client devices out is a known founder to-do). The plumbing is real and ready; it just
> hasn't been populated.

## How to check it's working

1. **Enrollment actually took.** Issue a token, redeem it from a device, and confirm the device
   **appears in the table** with status **online**, the role you chose, and the current policy
   version. That round-trip — token issued → device shows up online — is the real signal enrollment
   works. (Until you enroll one, the table is honestly empty.)
2. **The device is reporting in.** Watch its **Last seen** — it updates to a recent time each time the
   device pulls policy or pushes activity. A device whose Last seen stops advancing has gone quiet;
   its status falls to **offline**. That's a live heartbeat, not a static record.
3. **Policy convergence works.** Push a new policy version in [Policy](policy.md), then watch the
   device's **Policy** column climb to the new version on its next check-in — proof the fleet is
   obeying central policy.
4. **The kill switch registers.** Trigger it on a test device and confirm a `device.kill` entry lands
   in the [Audit Log](audit-logs.md) with your actor and an **ok** outcome — that's the accountable
   record that the stop was issued.

Do not judge health by counts alone: an empty fleet is a fleet with no devices enrolled, not a broken
page.

## Related
- [Policy](policy.md) — the org policy every device converges to.
- [AI Gateway & Model Routing](model-routing.md) — the *server* model pool (a different fleet).
- [Audit Log](audit-logs.md) — where `device.kill` and other device actions are recorded.
- [Services](services.md) — is the console/backing service that devices talk to actually up?
