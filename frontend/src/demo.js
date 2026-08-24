// Demo mode: a clearly-labeled, fully local walkthrough contract.
// NEVER mixes with blockchain state — demo contracts live only in memory
// and every demo surface carries the DEMO marker.

export const DEMO_CONTRACT = {
  id: 'DEMO-GL-2048',
  demo: true,
  client: '0xDem000000000000000000000000000000000C1ient',
  freelancer: '0xDem000000000000000000000000000000000Freelncr',
  title: 'Build SaaS landing page',
  description:
    'Create a responsive marketing landing page for a B2B SaaS product. Deliver a publicly accessible deployment and the source repository. The page must include a hero section, a pricing section and a working contact form.',
  criteria: [
    'Landing page is publicly accessible at the submitted URL',
    'Page includes a hero section with a headline',
    'Page includes a pricing section with at least three tiers',
    'Page includes a contact form that validates input',
    'Layout is responsive at 375px viewport width',
    'Source repository is submitted and contains the project',
  ],
  deadline: '2026-09-30',
  budget_atto: '500000000000000000000',
  status: 'PAID',
  evidence_urls: [
    'https://demo.example.com/landing',
    'https://github.com/demo/saas-landing',
  ],
  explanation:
    'Deployed the landing page and pushed the source repository. The contact form validates required fields client-side.',
  dispute_reason: '',
  verdict_overall: 'PASSED',
  verdict_criteria: JSON.stringify([
    { index: 1, result: 'PASS', reason: 'Submitted URL resolves and renders the landing page' },
    { index: 2, result: 'PASS', reason: 'Hero section with headline found in the retrieved page' },
    { index: 3, result: 'PASS', reason: 'Pricing section with three tiers found' },
    { index: 4, result: 'PASS', reason: 'Contact form markup with validation attributes found' },
    { index: 5, result: 'PASS', reason: 'Responsive viewport meta and fluid layout confirmed' },
    { index: 6, result: 'PASS', reason: 'Repository retrieved and contains the project files' },
  ]),
  verdict_reasoning:
    'All six acceptance criteria were verified against the retrieved deployment and repository evidence. No criterion required an UNVERIFIABLE marking.',
};

export const DEMO_STEPS = [
  { label: 'Create contract', detail: 'Client defines title, deliverables and six objective acceptance criteria.' },
  { label: 'Lock payment', detail: '500 GEN is escrowed inside the Intelligent Contract at creation.' },
  { label: 'Complete work', detail: 'A freelancer accepts and builds against the published criteria.' },
  { label: 'Submit evidence', detail: 'Deployment URL, repository link and an explanation are submitted on-chain.' },
  { label: 'GenLayer verifies', detail: 'Validators retrieve the evidence and score every criterion independently.' },
  { label: 'Payment settles', detail: 'All criteria satisfied — the escrow releases to the freelancer automatically.' },
];
