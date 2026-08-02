> ## STATUS — where the product stands against this document
>
> This file is the PRODUCT DEFINITION and is not edited by implementation work. This block is the only
> addition: a pointer to what has been verified, so a reader is not left guessing which of the promises
> below are real.
>
> **Evidence lives in [`ROADMAP_REAL_AUDIT.md`](ROADMAP_REAL_AUDIT.md)** — one row per flow, each stating
> what was exercised on the live box and what the artifact said. A gate is only promoted by someone who
> ran it and read the output.
>
> **§10 — the nine user flows (2026-08-02).** Flows 1, 2, 3, 5, 6, 7 and 8 have been walked end to end
> on the live deployment. Flow 4 (build from a template) is wired but its adoption has not been watched;
> Flow 9 (node intelligence) is out of scope by the founder's decision. Four product defects were found
> and fixed in the walking: an on-prem operator could not connect their own private-network database;
> every reviewer correction was written to the platform org so no tenant ever learned from it; masking
> turned a claim number into `EXP-[PHONE]` in the reviewer's evidence; and the decision buttons sat
> off-screen at 1600px.
>
> **§12 — the 160 technical table stakes (2026-08-02).** Probed for the first time with a replayable
> harness (`scripts/verify-table-stakes.mjs`): **108 present · 0 absent · 40 not establishable from
> inside one install** (deployment topology, CI scanning, SLAs, and settings this box does not enable —
> SSO providers activate from env and are unset here). Per category:
>
> | | present | not probeable |
> |---|---|---|
> | Observability | 13 | 0 |
> | Evaluation | 14 | 1 |
> | Data | 12 | 1 |
> | Models | 13 | 4 |
> | Agents | 11 | 3 |
> | Compliance | 10 | 1 |
> | Security | 10 | 6 |
> | DevEx | 8 | 6 |
> | Identity | 7 | 4 |
> | Reliability | 7 | 7 |
> | Deployment | 3 | 7 |
>
> "Not probeable" is a deliberate third verdict. Twenty of these first read as ABSENT because the probe
> used route names typed from what the surfaces are CALLED rather than enumerated from `src/app/api`,
> and forty-five more because the harness tripped our own rate limiter. Both were the instrument, not
> the product; recording either would have manufactured sixty-five fake gaps.
>
> ---

OGAC Product Definition
1. What OGAC is

OGAC is the enterprise control plane for Off Grid AI.

It connects intelligence across people, devices, conversations, machines, systems, and enterprise data, then lets employees turn that intelligence into working apps, agents, and automations.

OGAC is not just:

A chatbot
An agent builder
An enterprise search product
A model gateway
An internal app builder
A governance dashboard

It combines all of these into one governed operating layer for enterprise AI.

The core model is:

Data and context → governed gateway → pipelines → apps and agents → outcomes and evidence

OGAM and OGAD capture intelligence where work happens. OGAC compounds that intelligence across the organization and makes it usable according to role, task, permissions, and policy.

2. Goal

The goal is to enable every person to operate with the intelligence and capabilities of the entire enterprise.

An employee should not need to know:

Which database contains the answer
Which model to use
Which API to call
Which policy applies
How to create an agent
How to deploy software
How to implement auditability
How to monitor quality

They should describe the outcome they need.

OGAC should determine:

What data is permitted
What models are allowed
What tools can be called
What policies apply
Whether human approval is required
How the workflow should be evaluated
How the result should be recorded and audited

The product should make the enterprise faster without making it less controlled.

3. Long-term vision

In ten years, OGAC should become the default platform enterprises use to build, deploy, govern, and improve AI.

It should become the enterprise equivalent of AWS for AI:

One place to connect models, data, systems, devices, employees, and agents
One control layer for permissions, policies, quality, cost, and compliance
One environment where employees create software in natural language
One marketplace of reusable apps, agents, workflows, connectors, and industry solutions
One ecosystem where implementation partners build services on top of the platform

Thousands of enterprises should use OGAC directly, while systems integrators, consulting firms, domain experts, and developers build solutions on top of it.

The long-term asset is not only the platform. It is the accumulated library of governed applications, workflows, evaluations, policies, and industry-specific operating knowledge.

4. The problem OGAC solves

Enterprises are built for control, redundancy, and risk reduction. This makes them slow, expensive, and difficult to change.

Their intelligence is fragmented across:

Employees
Meetings
Calls
Desktops
Phones
Machines
Documents
Databases
SaaS applications
Policies
Informal workflows
Historical decisions

Most enterprise AI products only operate on information that has already been centralized.

But much of the most valuable knowledge is never centralized:

How experienced employees handle exceptions
Why a particular decision was made
What signals field workers notice
How actual work differs from the written process
Which shortcuts are safe
Which customers are likely to churn
Which operational failures are about to occur
What employees repeatedly ask each other

OGAC converts this fragmented intelligence into an organizational capability.

5. The three layers Off Grid AI owns
Layer 1: Inference

Comparable point products:

Ollama
LM Studio
Model gateways
Cloud model APIs

Off Grid AI provides local, private, cloud, and hybrid inference.

OGAC should route each request based on:

Data sensitivity
Cost
Latency
model capability
customer policy
jurisdiction
hardware availability
task complexity

Inference is an implementation detail for the employee. OGAC chooses the correct path.

Layer 2: Intelligence at the node

Comparable point products:

Screenpipe
Littlebird
Meeting intelligence tools
Device context products

OGAM and OGAD operate where work happens.

They can identify:

Decisions
SOPs
Repeated processes
Risks
Opportunities
Commitments
Customer context
Operational exceptions
Lessons that should be shared
Tasks that can be automated

Raw data can remain on the device. Only derived, permissioned intelligence enters the organization.

Layer 3: Action

Comparable point products:

Pints AI
FurtherAI
Copilot Studio
Retool
Vertical agent companies

OGAC turns intelligence into:

Applications
Agents
Workflows
Automations
Reviews
Recommendations
Alerts
Decisions
Regulatory evidence

Owning all three layers is important because each one improves the others.

Better node intelligence produces better applications. Better applications generate better organizational knowledge. Better governance allows more employees and systems to participate safely.

6. Primary users

OGAC is a multi-user platform. Each user sees a different product.

CIO and CTO

They care about:

AI adoption across the enterprise
Architecture
Security
Integration
Cost
Vendor control
Deployment
Reliability
Standardization

Their question is:

Can this become the approved way our company uses AI?

Chief Data Officer and AI platform team

They care about:

Model access
Data access
Retrieval
Quality
Evaluation
Reuse
Experimentation
Observability
Data lineage

Their question is:

Can teams build quickly without creating another uncontrolled AI stack?

CISO and security team

They care about:

Data movement
Identity
Permissions
Egress
Secrets
Prompt injection
PII
Tenant isolation
Audit logs
Incident response

Their question is:

Can we prove that the system cannot operate outside our controls?

Risk, compliance, and legal

They care about:

Explainability
Evidence
Policy enforcement
Human approvals
Regulatory mapping
Retention
Consent
Reversibility
Auditability

Their question is:

Can we defend every important automated action to an auditor or regulator?

Business-unit leader

They care about:

Cost
Throughput
Quality
Turnaround time
Error reduction
New capabilities
Adoption

Their question is:

Will this improve a measurable business process?

Subject-matter expert

This is one of the most important users.

They know how the work should be done but do not write software.

They should be able to:

Describe a workflow
Connect approved knowledge
Define expected outcomes
Test examples
Add exceptions
Request approvals
Publish an application

Their question is:

Can I turn what I know into software without waiting for engineering?

Employee or field worker

They should not need to understand the platform.

They interact with:

A task
An application
A recommendation
A nudge
A form
An approval request
A conversational interface

Their question is:

Does this help me complete my work faster and correctly?

Forward-deployed engineer

FDEs will be central during the first phase.

They need to:

Connect customer systems
Configure workflows
Build reusable components
Diagnose failures
Create evaluations
Productionize use cases
Move customer-specific work into reusable product capability

Their question is:

Can I deploy value in weeks without creating unmaintainable custom software?

7. How OGAC gets used

OGAC should support two primary operating modes.

Central platform mode

The enterprise AI team configures:

Models
Data sources
Identity
Policies
Guardrails
Budgets
Evaluations
Compliance controls
Deployment environments

Business teams then build on top of this approved foundation.

Business-led creation mode

An employee says:

Review incoming insurance claims, check whether all required documents are present, compare the claim against policy rules, highlight inconsistencies, and send uncertain cases to a human reviewer.

OGAC should:

Identify the relevant systems and data.
Determine what the employee can access.
Select approved models and tools.
Propose a workflow.
Generate the application.
Generate tests and evaluations.
Run it in a sandbox.
Show expected cost and risk.
Route it for approval.
Publish it to the permitted users.
Monitor every production run.

The user creates an outcome, not an AI pipeline.

8. Core product areas
A. Organizational intelligence

OGAC should maintain a permissioned intelligence graph across:

People
Teams
Systems
Data
Documents
Decisions
Processes
Apps
Agents
Models
Policies
Outcomes

The system should know:

Where a piece of knowledge came from
Who can access it
When it was created
Whether it is still valid
Which workflows depend on it
Which decisions used it
How confident the system is
Whether a human verified it

This cannot become an unstructured company-wide memory dump.

B. Data plane

OGAC should connect to:

Databases
Data warehouses
File systems
SharePoint
Google Drive
CRMs
ERPs
Ticketing systems
Email
Messaging
Document repositories
Core banking systems
Insurance systems
Industry-specific systems
Machine and sensor data
OGAM and OGAD nodes

Capabilities should include:

Schema discovery
Data classification
Incremental synchronization
Permissions mapping
Lineage
Retention controls
Data quality checks
Retrieval
Structured and unstructured querying
C. Governed model gateway

One controlled door to every model.

It should support:

Local models
Customer-hosted models
Private cloud models
External model APIs
Model fallback
Cost-aware routing
Latency-aware routing
Data-class-aware routing
Task-specific routing
Rate limits
Kill switches
Request and response logging
Redaction
Caching

A policy should be able to state:

Restricted customer data may only use models running inside the customer’s infrastructure.

That policy must be technically enforced, not shown as a warning.

D. Pipelines

A pipeline binds together:

Data
Retrieval
Models
Prompts
Tools
Policies
Guardrails
Evaluations
Human approvals
Output schemas
Cost limits
Monitoring

A pipeline should be versioned and reusable.

Every app or agent built on top should inherit it.

E. Studio

Studio is where nontechnical employees build applications and agents.

It should allow users to:

Describe the desired outcome
Upload examples
Select approved sources
Review the generated workflow
Test it against realistic cases
Correct mistakes
Add business rules
Add human review
Publish it

The system should explain what it is building in business language.

It should not expose a complex node graph by default.

A visual workflow editor can exist, but it should be secondary.

F. Apps and agents

Apps should support:

Conversational experiences
Forms
Dashboards
Review queues
Case management
Batch processing
Background workflows
Alerts
Scheduled jobs
API access
Mobile and field experiences

Agents should support:

Tool use
Memory
Delegation
Human escalation
Retry
Timeouts
Approval
Structured outputs
Deterministic workflow steps
Long-running jobs
G. Human review

Human approval cannot be an afterthought.

The review experience should show:

What the system wants to do
Why it wants to do it
Which sources it used
What policy applies
What uncertainty remains
What happens after approval
What happens after rejection

Approvers should be able to:

Approve
Reject
Edit
Ask for more information
Reassign
Escalate
Add a reason

That reason should feed future evaluation and learning.

H. Evaluation and AI quality

Every production use case should have:

Golden datasets
Expected outcomes
Regression tests
Faithfulness checks
Groundedness checks
Safety tests
Business-quality metrics
Drift monitoring
Prompt degradation detection
Model comparison
Human feedback

Quality should be visible by:

Application
Agent
Model
Team
Version
Dataset
Time period
I. Governance and compliance

OGAC should manage:

RBAC
ABAC
Data classifications
Model policies
Tool permissions
Egress policies
Approval policies
Retention
Audit logs
Consent
Regional controls
Regulatory evidence
Policy versioning

Every important run should be:

Identifiable
Reproducible where possible
Cited
Signed
Versioned
Attributable
Reversible where possible
J. Observability and FinOps

The enterprise should see:

Who is using AI
What they are using it for
Which data is accessed
Which models are called
What each run costs
What failed
What was blocked
What quality score was achieved
What business outcome was produced

FinOps should support:

Budgets
Cost allocation
Alerts
Model comparison
Cost per workflow
Cost per successful outcome
Team and user limits
Chargeback or showback
9. Critical user experience principles
Outcome first

The employee should begin with:

What are you trying to accomplish?

Not:

Choose a model, vector database, orchestration framework, and prompt template.

Progressive disclosure

Simple users see simple controls.

Advanced users can inspect:

Prompt
Model
Retrieval
Tools
Policies
Evals
Logs
Versions

The complexity exists, but it is revealed only when needed.

Explain every important action

The system should answer:

What happened?
Why did it happen?
What information was used?
What rule permitted it?
Who approved it?
How certain is the result?
What should happen next?
Governance should feel native

Users should not experience governance as a separate compliance portal.

It should appear naturally inside creation and execution:

This source cannot be used for this audience.
This action requires manager approval.
This model cannot process this data class.
This workflow failed its quality threshold.
This output cannot be published without a citation.
Fast path and expert path

A business user should create a useful application quickly.

An engineer should be able to inspect and control every technical detail.

Both should use the same underlying object, not separate products.

Trust through visibility

A user should never wonder:

Is this running?
Did it fail?
Is it waiting for approval?
Which source did it use?
Did data leave the company?
What will this cost?

The interface must expose system state clearly.

10. Most important user flows
Flow 1: Enterprise setup
Create tenant.
Configure deployment.
Connect identity provider.
Import organizational structure.
Configure model providers.
Define data classifications.
Define global policies.
Configure audit and retention.
Add initial data sources.
Invite platform administrators.

Time to a working environment should be measured in hours, not months.

Flow 2: Connect a data source
Choose source.
Authenticate.
Discover schemas and content.
Classify data.
Map source permissions.
Select sync scope.
Test retrieval.
Review lineage.
Approve connection.
Monitor sync health.
Flow 3: Create an application in natural language
Describe the goal.
OGAC asks clarifying questions.
OGAC identifies available data, tools, and policies.
OGAC proposes a workflow.
User reviews the plain-language plan.
OGAC generates the app and tests.
User tests with examples.
User corrects failures.
OGAC generates or updates evaluations.
App is submitted for approval.
App is published.
Flow 4: Build from a template
Select industry or function.
Choose a workflow.
Connect required systems.
Map customer-specific fields.
Configure policies.
Run test dataset.
Review quality.
Publish.

This will be important for repeatable FDE deployments.

Flow 5: Use an application
Employee opens app from web, mobile, or existing system.
App loads role-specific context.
Employee submits task.
Pipeline runs.
Human approval is requested if necessary.
Result is returned with citations and next actions.
Run is recorded.
Feedback is collected.
Flow 6: Review and approve
Reviewer sees pending item.
Reviewer understands the action and evidence.
Reviewer sees risk and confidence.
Reviewer approves, edits, rejects, or escalates.
Decision is logged.
Workflow continues.
Feedback enters the evaluation system.
Flow 7: Investigate failure
Alert shows failed or degraded run.
Operator opens execution trace.
Operator sees data, model, prompt, tool, policy, and evaluation stages.
Operator identifies the failure.
Operator compares with previous versions.
Operator fixes and tests.
Operator rolls out or rolls back.
Flow 8: Compliance export
Select regulation, period, application, or incident.
OGAC collects relevant runs, policies, approvals, versions, sources, and evaluations.
System generates evidence pack.
Compliance team reviews.
Export is signed and archived.
Flow 9: Node intelligence contribution
OGAM or OGAD identifies a potentially useful signal.
Local policy determines whether it may leave the device.
User may review or approve.
Raw data stays local.
Derived signal is sent with provenance and permissions.
OGAC links it to relevant organizational context.
The signal becomes available to approved people and workflows.
11. Non-negotiables
Customer control

The customer controls:

Deployment
Data
Models
Policies
Access
Retention
Egress
Audit
Deletion

Off Grid AI cannot require unrestricted access to customer information.

Raw data can remain local

The architecture must support meaningful value without centralizing all raw data.

This is fundamental to the product, not an optional privacy mode.

Governance is inherited

Every application and agent must inherit organizational controls.

Governance cannot depend on each builder implementing it correctly.

Model neutrality

OGAC cannot be tied to one model provider.

Models will change rapidly. The governance, data, applications, workflows, and organizational intelligence should remain.

Full observability

No invisible agent behavior.

Every important action must leave an understandable record.

Human control for consequential actions

The platform must support explicit approvals, escalation, override, and reversal.

Security by enforcement

Policies must block prohibited behavior technically.

A warning banner is not a security control.

Honest product state

The UI must distinguish:

Production-ready
Experimental
Degraded
Not configured
Failed open
Failed closed
Awaiting approval

The product must never imply that a control is active when it is not.

Enterprise reliability

A failed AI component must not silently corrupt a business process.

The system should stop, retry, escalate, or fall back according to explicit policy.

12. Technical table stakes
Deployment
Customer cloud
Customer data center
Private cloud
Hybrid deployment
Air-gapped or restricted-network support where required
Docker and Kubernetes support
Infrastructure-as-code
Environment separation
Backup and restore
Disaster recovery
Identity and access
SSO
SAML and OIDC
SCIM
RBAC
ABAC
Service accounts
API keys
Temporary credentials
Fine-grained permissions
Separation of duties
Break-glass access
Security
Encryption in transit and at rest
Tenant isolation
Secret management
Key rotation
Vulnerability scanning
Dependency scanning
Container scanning
Audit logging
SIEM integration
Data-loss prevention
Egress control
PII detection and masking
Prompt-injection defense
Tool sandboxing
Network policies
Rate limiting
Reliability
Durable execution
Idempotency
Retries
Timeouts
Dead-letter queues
Checkpointing
Circuit breakers
Rollback
Version pinning
High availability
Horizontal scaling
Graceful degradation
Service-health monitoring
Defined SLOs and SLAs
Data
Structured and unstructured connectors
Incremental sync
Change-data capture
Permission-aware retrieval
Data classification
Lineage
Provenance
Retention
Deletion
Legal holds
Data residency
Schema evolution
Data-quality monitoring
Model operations
Multi-model support
Local and cloud inference
Model routing
Fallback
Versioning
Prompt versioning
Context management
Token and cost tracking
Caching
Batch inference
Streaming
Structured outputs
Tool calling
Model evaluation
A/B testing
Canary releases
Rollback
Agent operations
Sandboxed tools
Permissioned tool access
Long-running execution
Durable state
Human approval
Delegation
Scheduling
Event triggers
Concurrency control
Budget control
Loop detection
Maximum-step limits
Execution replay
Kill switches
Evaluation
Golden datasets
Regression testing
Offline evaluations
Online evaluations
Business metrics
Groundedness
Faithfulness
Safety
Bias
Latency
Cost
Human review
Drift detection
Quality thresholds
Release gates
Observability
End-to-end traces
Logs
Metrics
Per-run timeline
Model and tool spans
Cost breakdown
Error diagnosis
Policy decisions
Approval history
Data lineage
Quality scores
Business outcomes
Export to existing observability tools
Compliance
Immutable or append-only audit trail
Policy version history
Evidence export
Control mapping
Data-processing records
Consent records
Incident records
Model and application inventory
Risk classification
Human oversight records
Regulatory retention
Developer experience
APIs
SDKs
CLI
Webhooks
OpenAI-compatible interfaces
Local development
Test environments
Mock data
CI/CD integration
Version control
Promotion between environments
Extension framework
Connector SDK
App and agent packaging
13. Product success metrics

OGAC should not be measured by prompts or model calls.

The important metrics are:

Adoption
Active employees
Active teams
Active applications
Apps built by nontechnical users
Time to first application
Time to production
Business impact
Hours saved
Cycle-time reduction
Cost per completed process
Error reduction
Quality improvement
Revenue generated
Risks detected
Capabilities created
Reuse
Templates reused
Pipelines reused
Policies reused
Shared organizational signals
Number of applications using a common capability
Reliability
Successful runs
Failed runs
Human escalation rate
Policy violation rate
Rollback rate
Mean time to resolution
Quality
Evaluation scores
Human acceptance rate
Correction rate
Drift
Citation accuracy
Groundedness
Governance
Percentage of AI activity routed through OGAC
Percentage of apps with evaluations
Percentage of consequential actions with required approval
Number of blocked policy violations
Time required to generate audit evidence
14. Initial product wedge

The full vision is broad. The first deployment should be narrow.

The best initial wedge is:

Governed AI applications for regulated or field-heavy enterprises, deployed through forward-deployed engineers.

Each initial customer should receive:

A production OGAC deployment
Core data and identity integrations
A small number of high-value use cases
Clear business metrics
Human approval and auditability
A reusable path to additional use cases

Good initial workflows include:

Insurance claims triage
Underwriting support
KYC review
Policy and procedure assistance
Field-service documentation
Operational exception detection
Sales opportunity identification
Compliance evidence generation
Call and meeting intelligence
Logistics incident handling

The platform vision remains broad, but the customer initially buys one measurable outcome.

15. The product promise

OGAC should ultimately make this statement true:

Describe what your enterprise needs. Off Grid AI will use your approved intelligence, systems, models, policies, and controls to create and operate it.

The product wins when an enterprise can move with the speed of a startup without giving up the reliability, security, auditability, and control it requires.
