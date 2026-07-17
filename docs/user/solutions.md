# Solution Blueprints — adopt a high-value use case without inventing proof

Status: ✅ versioned adoption contract (2026-07)

Solution Blueprints capture a reusable BFSI outcome hypothesis: the business owner, required data,
runtime capabilities, governed pipeline, KPI baseline and target, economic assumptions, and any
auditable benchmark evidence. They do not contain a tenant's measured result.

Use **Solutions › Library** to inspect a Blueprint. The two starter contracts — delinquency
intervention and indemnity claim fast-track — are intentionally marked **unverified**. Their example
baselines and targets are prompts for customer discovery, not claims that Off Grid has already
proved those values. Mark a Blueprint verified only after attaching evidence that another operator
can open and audit.

## Adopt a Blueprint

1. Open the Blueprint and choose **Deploy through an existing App**. The selected Blueprint stays in
   the URL and is preselected on the adoption screen.
2. Choose a compatible App. The Console only offers published Apps whose actual graph contains every
   required data domain and capability, and whose exact published pipeline has the required data
   ceiling. A label match is not sufficient.
3. Choose **Adopt Blueprint**. The deployment pins the current immutable Blueprint version and the
   App's exact pipeline. Later Blueprint edits create a new version and never rewrite the adopted
   contract.
4. Run the App normally. Before each run, the Console rechecks the active deployment. If the App,
   pipeline, publication state, domain ceiling, or capabilities drift, execution stops with a
   conflict and records a blocked audit event.

If no App is compatible, fix or publish the App and pipeline first. The Console will not create a
nominal “active” deployment that cannot execute the advertised contract.

## Record measured value

Open **Solutions › Deployed** and choose a deployment. Record one bounded production window at a
time:

- start and end timestamps;
- observed KPI value and label;
- completed runs;
- estimated minutes saved per run and loaded hourly cost;
- actual AI cost; and
- links to supporting evidence.

Realized ROI is calculated by the same canonical rule used throughout the Console:

- estimated hours saved = completed runs × minutes saved per run ÷ 60;
- estimated gross value = estimated hours saved × loaded hourly cost;
- realized net value = estimated gross value − actual AI cost.

The page shows only App runs after the deployment's activation timestamp. Pre-adoption history and
App-wide reports are not counted as proof for this deployment.

## Lifecycle and audit

- Editing a Blueprint appends a version; existing deployments remain pinned.
- Retiring a Blueprint hides it from new adoption but retains every version and deployment.
- Removing a deployment retires it; observations remain.
- An App referenced by deployment history cannot be deleted. Retire the deployment instead.
- Create, edit, retire, adopt, measure, and runtime-denial actions are admin-gated and audited.
