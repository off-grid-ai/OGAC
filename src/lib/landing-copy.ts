// ─── Landing copy — the single source of truth for the public landing page (onprem-console…) ────────
//
// Transcribed verbatim from the brand-approved copy (off-grid-ai/ogac-landing-page-copy · copy.json).
// Copy lives HERE, separate from layout (page.tsx renders it) so a writer can edit words without
// touching JSX. Brand rules baked into the source: lead with outcomes; never name underlying OSS in
// sales copy; plain language, no buzzwords, no em dashes; no invented customers/ROI. Product name is
// always "Off Grid AI" (never bare "Off Grid").

export const LANDING = {
  brand: 'Off Grid AI',
  links: {
    liveProduct: 'https://onprem-console.getoffgridai.co/',
    source: 'https://github.com/off-grid-ai/OGAC',
    docs: '/docs',
    email: 'mailto:mac@getoffgridai.co',
  },
  nav: [
    { label: 'Platform', href: '#capabilities' },
    { label: 'Use Cases', href: '#outcomes' },
    { label: 'Trust', href: '#trust' },
    { label: 'Company', href: '#overview' },
  ],
  hero: {
    eyebrow: 'Off Grid AI',
    headline: 'Enable every person to operate with the intelligence and capabilities of the entire enterprise.',
    supporting: 'More done, better work, new capabilities. With enterprise reliability and control.',
    offer: 'Five working AI use cases. Live in 14 days. Zero cost. Outcomes guaranteed.',
    cta: 'View the live product',
    trustLabel: 'See it live:',
    trustItems: ['Bank tenant', 'Insurer tenant', 'Source available'],
    layers: [
      { number: '01', name: 'Learn from work', points: ['Understand how work happens on phones and desktops.', 'Raw content stays on-device.', 'Only useful intelligence is shared.'] },
      { number: '02', name: 'Build organizational memory', points: ['Connect signals with enterprise data and knowledge.', 'Return the right guidance by role and context.', 'Every lesson outlives the person who learned it.'] },
      { number: '03', name: 'Turn knowledge into action', points: ['Describe the need in plain language.', 'Get an app, agent, or automation.', 'Human review where it matters.'] },
      { number: '04', name: 'Stay in control', points: ['Your rules apply to every use case.', 'See what happened, why, and what it cost.', 'Trace every result to its sources.'] },
    ],
  },
  overview: {
    number: '01',
    kicker: 'Overview',
    heading: 'Your enterprise should get smarter every time it works.',
    body: 'Off Grid AI turns everyday work into organizational intelligence, ready for anyone to run as a governed app, agent, or automation.',
    workflowName: 'Field interaction',
    workflowLabel: 'One example',
    steps: [
      { number: '01', title: 'Understand work privately', description: 'The raw conversation stays on-device.' },
      { number: '02', title: 'Capture what matters', description: 'Spot an SOP, risk, opportunity, or lesson.' },
      { number: '03', title: 'Add enterprise knowledge', description: 'Combine it with approved data and policy.' },
      { number: '04', title: 'Act while it matters', description: 'Deliver guidance or trigger an app or approval.' },
    ],
    pillars: [
      { label: 'EDGE', name: 'Learn', description: 'Capture intelligence privately where work happens.' },
      { label: 'BRAIN', name: 'Remember', description: 'Turn scattered knowledge into shared memory.' },
      { label: 'BUILDER', name: 'Act', description: 'Turn a need into a working app or agent.' },
      { label: 'PLATFORM', name: 'Control', description: 'Keep every result safe and accountable.' },
    ],
  },
  capabilities: {
    number: '02',
    kicker: 'Capabilities',
    heading: 'Learn from the enterprise. Put that intelligence to work.',
    intro: 'Connect how work happens to the systems and controls you already have.',
    items: [
      { number: '01', name: 'Learn', summary: 'Understand work where it happens. Raw content never leaves the device.', visual: 'Intelligence at the nodes' },
      { number: '02', name: 'Remember', summary: 'Keep knowledge and share it beyond the original expert.', visual: 'Organizational memory' },
      { number: '03', name: 'Act', summary: 'The people closest to the work build apps and agents in plain language.', visual: 'Intelligence turned into action' },
      { number: '04', name: 'Control', summary: 'Apply policy once. Every result stays accountable.', visual: 'Enterprise control' },
    ],
  },
  numbers: {
    number: '03',
    kicker: 'Numbers',
    heading: 'A concrete way to start.',
    intro: 'Prove outcomes before taking on any risk.',
    metrics: [
      { label: 'First deployment', value: '5 use cases', description: 'Built around outcomes agreed with you.' },
      { label: 'Existing systems', value: '300+', description: 'Systems, files, and databases you already use.' },
      { label: 'Time to value', value: '14 days', description: 'Signed to first working deployment.' },
      { label: 'Your cost', value: '$0', description: 'Setup, install, and the first five.' },
      { label: 'Live product', value: '2', description: 'Seeded bank and insurer environments.' },
      { label: 'Free self-install', value: '25', description: 'Users on infrastructure you control.' },
      { label: 'Control mappings', value: '4', description: 'ISO 42001, NIST AI RMF, EU AI Act, DPDP.' },
    ],
  },
  outcomes: {
    number: '04',
    kicker: 'Outcomes',
    heading: 'A company that learns, acts, and stays accountable.',
    intro: 'A shorter distance between what the enterprise knows and what every person can do.',
    items: [
      { number: '001', name: 'Learn how work really gets done', description: 'Spot the methods, risks, and undocumented SOPs where work happens. Raw content stays on-device.', outcome: 'Learn from work that would otherwise disappear.' },
      { number: '002', name: 'Put the company behind every person', description: "Deliver the right context by role and situation, the moment it's needed.", outcome: 'Expertise spreads without exposing the interaction behind it.' },
      { number: '003', name: 'Turn expertise into working capability', description: 'Build apps and agents in plain language. Each one inherits your rules, permissions, and evidence.', outcome: 'Startup agility, without giving up enterprise reliability.' },
    ],
  },
  trust: {
    number: '05',
    kicker: 'Trust',
    heading: 'Know what happened. Know why. Stay in control.',
    intro: 'Control should make AI usable, not slow it down.',
    attributes: ['Explainable', 'Reviewable', 'Enforceable'],
    items: [
      { name: 'Provenance', outcome: 'See where every answer and action came from.' },
      { name: 'Citations', outcome: 'Check claims against their sources.' },
      { name: 'Observability', outcome: 'See what each use case did, where it failed, and what it cost.' },
      { name: 'Guardrails', outcome: 'Stop unsafe behavior before it becomes an action.' },
      { name: 'Human review', outcome: 'People at the decisions that need judgment, not every step.' },
      { name: 'Evaluation and drift', outcome: 'Catch declining quality before your users do.' },
    ],
  },
  pricing: {
    number: '06',
    kicker: 'Pricing',
    heading: 'Start with proof, not a platform commitment.',
    intro: 'First five use cases free, outcomes agreed upfront. See it work, then decide.',
    plans: [
      { name: 'Self-installed', price: 'Free', suffix: '', description: 'The platform for business, free for up to 25 users.', cta: { label: 'View the source', href: 'source' as const }, features: ['Up to 25 users', 'Run it yourself', 'Source available', 'Your infrastructure'] },
      { name: 'Managed', price: '$150', suffix: '/month', description: 'Installed and managed for teams up to 50.', cta: { label: 'View the product', href: 'liveProduct' as const }, features: ['Up to 50 users included', '$2.99 per user above 50', 'Installation included', 'Platform updates included'] },
      { name: 'Enterprise', price: 'Custom', suffix: '', description: 'Five working use cases in 14 days, at no cost.', cta: { label: 'Start with five', href: 'liveProduct' as const }, features: ['Five-use-case proof', 'Outcomes agreed upfront', 'Unlimited-user licensing available', 'Enterprise support available'] },
    ],
    comparison: {
      planNames: ['Self-installed', 'Managed', 'Enterprise'],
      rows: [
        { capability: 'People included', values: ['Up to 25', 'Up to 50', 'Unlimited'] },
        { capability: 'First use cases', values: ['Your team', 'Your team', 'First five included'] },
        { capability: 'Existing data and systems', values: ['Included', 'Included', 'Custom discovery'] },
        { capability: 'Choice of AI models', values: ['Included', 'Included', 'Included'] },
        { capability: 'Organizational knowledge', values: ['Included', 'Included', 'Included'] },
        { capability: 'Plain-language creation', values: ['Included', 'Included', 'Included'] },
        { capability: 'Governance and evidence', values: ['Included', 'Included', 'Included'] },
        { capability: 'Installation', values: ['Self-managed', 'Included', 'Included'] },
        { capability: 'Ongoing management', values: ['Self-managed', 'Included', 'Agreed with you'] },
        { capability: 'Support and legal terms', values: ['Community', 'Managed', 'Enterprise terms'] },
      ],
    },
  },
  proof: {
    number: '07',
    kicker: 'Proof',
    heading: 'Judge the product before the pitch.',
    intro: 'Explore live bank and insurer environments. Trace any use case end to end.',
    quotePlaceholder: 'Named CIO proof belongs here: the starting problem, five deployed use cases, the 14-day result, and the agreed business outcome.',
  },
  insights: {
    number: '08',
    kicker: 'Insights',
    heading: 'The case for enterprise intelligence.',
    intro: 'The thesis, the operating model, and the controls that make it practical.',
    articles: [
      { title: 'Why enterprise AI needs an operating layer', summary: 'The missing bridge between frontier models and how an enterprise works.' },
      { title: 'How an enterprise learns from its own work', summary: 'Turning scattered experience into reusable intelligence.' },
      { title: 'What makes an AI answer trustworthy', summary: 'How citations, provenance, and evaluation let people verify a result.' },
      { title: 'What the 14-day enterprise proof includes', summary: 'Five use cases, agreed outcomes, zero upfront cost.' },
    ],
  },
  faq: {
    number: '09',
    kicker: 'FAQ',
    heading: 'Frequently asked questions.',
    asideKicker: 'Still have questions?',
    asideHeading: 'See the product before you speak to us.',
    asideBody: 'Synthetic banking and insurance data. Public, source-available repository.',
    items: [
      { q: 'What does Off Grid AI actually do?', a: 'It learns from how work happens, delivers that knowledge by role and context, and turns it into governed apps, agents, and automations.' },
      { q: 'What is included in the 14-day proof?', a: 'Five agreed use cases, live as apps or agents in 14 days. Setup and those five cost nothing.' },
      { q: 'Can we run it on our own infrastructure?', a: 'Yes, on infrastructure you control. External models are optional and governed by your policy.' },
      { q: 'Can non-technical teams create with it?', a: 'Yes. Describe the process in plain language, bind approved data, add review, and run it inside the same controls.' },
      { q: 'How do we know whether a result can be trusted?', a: 'Every run shows its sources, decisions, approvals, and cost. Verify it, investigate failures, or intervene.' },
      { q: 'Can we inspect the product before a call?', a: 'Yes. Explore the live environments and inspect the source before speaking to us.' },
    ],
  },
  footer: {
    trustBadges: ['ISO 42001 mapped', 'NIST AI RMF mapped', 'EU AI Act mapped'],
    ctaKicker: 'See it before you speak to us',
    ctaHeading: 'Open the platform. Follow a use case from enterprise data to an accountable result.',
    ctaBody: 'Explore a live bank or insurer environment for yourself.',
    ctaButton: 'View the live product',
    companyKicker: 'Off Grid AI',
    companyDescription: 'Turning organizational intelligence into governed action.',
    statusValue: 'ACTIVE',
    demoValue: '2',
    demoLabel: 'Live seeded enterprise environments',
    wordmark: 'OFF GRID AI',
    legal: ['© Off Grid AI', 'Source-Available License 1.0'],
  },
} as const;

export type LandingCopy = typeof LANDING;
