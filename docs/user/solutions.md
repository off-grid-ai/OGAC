# Solution Blueprints — adopt a high-value use case without inventing proof

Status: ✅ versioned adoption contract (2026-07)

Solution Blueprints capture a reusable BFSI outcome hypothesis: the business owner, required data,
runtime capabilities, governed pipeline, KPI baseline and target, economic assumptions, and any
auditable benchmark evidence. They do not contain a tenant's measured result.

Use **Solutions › Library** to inspect a Blueprint. The two starter entries — delinquency
intervention and indemnity claim fast-track — are intentionally marked **Hypothesis only** and
**unverified**. They do not point to a real App/template/pipeline asset, so the Console will not offer
them for adoption. Their example baselines and targets are prompts for customer discovery, not
claims that Off Grid has already proved those values. Make a Blueprint adoptable only when its
runtime contract names assets that really exist; mark it verified only after attaching evidence that
another operator can open and audit.

## Adopt a Blueprint

1. Open the Blueprint and choose **Deploy through an existing App**. The selected Blueprint stays in
   the URL and is preselected on the adoption screen.
2. Choose a compatible App. The Console only offers published Apps whose actual graph contains every
   required data domain and capability, and whose exact published pipeline has the required data
   ceiling. A label match is not sufficient.
3. Choose **Adopt Blueprint**. The deployment pins the current immutable Blueprint version and the
   App's exact pipeline. Later Blueprint edits create a new version and never rewrite the adopted
   contract.
4. Run the App normally. Before each run or approved continuation, the Console rechecks the active deployment. If the App,
   pipeline, publication state, domain ceiling, or capabilities drift, execution stops with a
   conflict and records a blocked audit event.

If no App is compatible, fix or publish the App and pipeline first. The Console will not create a
nominal “active” deployment that cannot execute the advertised contract.

## Record an operator KPI claim

Open **Solutions › Deployed** and choose a deployment. Record one bounded production window at a
time:

- start and end timestamps;
- claimed KPI value and label;
- estimated minutes saved per run and loaded hourly cost; and
- one or more links to supporting evidence.

The operator cannot enter or override completed-run count or AI cost. The Console selects completed
`app_runs` for the deployment's App whose finish time falls inside the evidence window and derives
cost from the same run/FinOps fields used by App Reports. It stores the selected run IDs with the
observation so the calculation remains auditable.

Estimated ROI is calculated over those measured run facts and the explicitly labelled labor
assumptions:

- estimated hours saved = completed runs × minutes saved per run ÷ 60;
- estimated gross value = estimated hours saved × loaded hourly cost;
- estimated net value = estimated gross value − actual AI cost.

The Console rejects future windows, overlapping windows, windows before activation, and windows that
end after deployment retirement. Pre-adoption or post-retirement App activity is never counted as
evidence for the deployment. The KPI itself remains an operator claim linked to evidence; a completed
run count does not prove that KPI.

## Lifecycle and audit

- Editing a Blueprint appends a version; existing deployments remain pinned.
- A Blueprint with an active or paused deployment cannot be retired. Retire every deployment first;
  this prevents a library action from silently invalidating a live runtime contract.
- Removing a deployment retires its binding; observations and run evidence remain immutable.
- Pausing a deployment blocks new runs and approved HITL continuations. Reactivation opens a new
  evidence interval; runs outside an active interval never count toward deployment value.
- Once the live binding is retired, the same App can adopt a newer Blueprint version or another
  Blueprint. Retired deployment history does not block re-adoption.
- An App referenced by deployment history cannot be deleted. Retire the deployment instead.
- Create, edit, retire, adopt, measure, and runtime-denial actions are admin-gated and audited.
