# ROI — hours and money your automations save

Status: ✅ documented (Surfaced ROI, 2026-07)

**What it is** — A value view, per app and per department, that answers the question a renewal or a
budget review always asks: *what did this automation actually give us back?* You see it in two
places — the **Insights › ROI** page (org-wide, by department, top apps by value) and a **Return on
investment** card on each app's **Reports** tab.

**Why use it** — When it's time to renew, or to justify next year's budget, the champion needs a
number. This turns run activity into "this saved X hours and ₹Y this period, at ₹Z of AI cost — a
net of ₹N." It's the difference between "the team likes it" and "it paid for itself N times over."

**When to use it** — Before a renewal conversation, in a quarterly business review, or any time
someone upstream asks whether the spend is worth it.

## How the number is built

Two of the inputs are **measured** and two are an **estimate you set** — and the screens label every
number as one or the other so nobody mistakes a projection for a fact.

- **Runs completed** *(measured)* — how many runs of the app finished successfully this period.
- **AI cost** *(measured)* — the actual cost of running those, converted to ₹.
- **Minutes saved per run** *(estimate)* — how long the same task took your team by hand. You set
  this; a sensible default applies until you do.
- **Loaded cost per hour** *(estimate)* — the fully-loaded cost of one staff hour (salary + overhead).

From those:

- **Hours saved** = runs completed × minutes saved per run ÷ 60
- **Value of time saved** = hours saved × loaded cost per hour
- **Net value** = value of time saved − AI cost
- **Value per ₹ of AI cost** = value ÷ AI cost (the "×" multiple)

If an app hasn't run, or you haven't set an estimate, the numbers read as honest zeros — never a
fabricated figure.

## Setting the estimates

- **Org-wide default** — on **Insights › ROI**, the *Org ROI assumptions* card sets the minutes-saved
  and loaded-cost-per-hour every app inherits.
- **Per-app override** — on an app's **Reports** tab, open the ROI card's **Edit estimate** to set
  that app's own minutes-saved / hourly cost. *Revert to org default* clears the override again.

Set minutes-saved from how long the task genuinely took a person before the automation existed. Keep
it conservative — an ROI story survives scrutiny only if the assumption behind it is defensible.

## Reading it by department

Each app rolls up under its owning team's **department** (set in Access › Teams & Departments). The
ROI page groups value by department and ranks the top apps by net value, so you can see which parts of
the business are getting the most back — and open any app to see and tune its own ROI card.

## What to check

- The per-app card and the Insights totals move when you change an estimate or when new runs land.
- The **estimate** vs **actual** tags are visible on every tile — that's the honesty guarantee.
- An app with no completed runs shows zeros, not an inflated projection.
