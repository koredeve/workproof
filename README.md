# WorkProof

**Freelance work. Verified by consensus.**

WorkProof is a trustless work verification and settlement protocol built on GenLayer. Clients create performance-based work contracts with objective acceptance criteria and lock payment in escrow. Freelancers submit evidence. GenLayer Intelligent Contracts retrieve the evidence from the web, score every criterion (PASS / FAIL / UNVERIFIABLE), and settle the escrow on the result — with every validator independently reaching consensus before any GEN moves.

> WorkProof does not ask GenLayer whether something is "good". It determines whether submitted evidence satisfies previously agreed contractual criteria.

## The problem

Traditional freelance platforms ask you to trust a company to decide whether work was completed correctly. That decision is opaque, centralized, and irreversible.

## The solution

1. **Client** posts a contract: title, description, objective acceptance criteria, deadline — and funds the escrow in the same transaction.
2. **Freelancer** accepts and submits evidence URLs plus an explanation.
3. **GenLayer verifies**: validators retrieve the submitted evidence from the live web, evaluate each acceptance criterion independently, and must agree on the per-criterion results.
4. **Settlement**: all criteria satisfied → escrow releases to the freelancer automatically. Any failure → the client can refund or either party can open a dispute, which is re-arbitrated strictly under the original criteria (they cannot be rewritten).

## Architecture

```
Client ──post+fund──▶ WorkProof Intelligent Contract (GenVM)
Freelancer ──submit evidence──▶        │
                                       │ verify_work()
                                       ▼
                        Leader: fetch evidence URLs (web)
                                + LLM evaluation per criterion
                                       │
                       Validators: independent re-run
                       (overall + per-criterion agreement,
                        ≤1 criterion tolerance, errors
                        classified EXPECTED/EXTERNAL/
                        TRANSIENT/LLM_ERROR)
                                       │
                     PASSED ──▶ escrow → freelancer
                     FAILED ──▶ refund or dispute
                     DISPUTED ──▶ re-arbitration under
                                  original criteria
```

## Why GenLayer?

Ordinary smart contracts cannot read a web page, and cannot decide whether "the page includes a pricing section" is true. Deterministic oracles cannot agree on the *meaning* of unstructured evidence. GenLayer's AI-validator consensus does exactly this: the leader proposes per-criterion results, every validator independently retrieves the evidence and re-evaluates, and the result only settles when they agree. Verification is evidence-based, criteria are immutable after acceptance, and every ruling is appealable before finalization through GenLayer's Optimistic Democracy.

## How verification works

```
Contract (criteria fixed at creation)
   → Freelancer submits evidence URLs + explanation
   → Leader retrieves evidence from the live web
   → LLM scores each criterion: PASS / FAIL / UNVERIFIABLE
   → Validators independently re-run and compare
        (overall must match; ≤1 criterion disagreement tolerated;
         unreachable evidence = TRANSIENT, retried by consensus)
   → Result + per-criterion reasons stored on-chain
   → Escrow settles: PAID / refund / dispute arbitration
```

## Tech stack

- **GenLayer Intelligent Contract** (Python, GenVM, pinned runner) — escrow, state machine, criteria-based adjudication
- **React + Vite** frontend with **genlayer-js** — EIP-6963 multi-wallet connection (MetaMask, Rabby, Phantom, Brave, Coinbase), wallet-signed transactions
- **Vitest** DOM interaction tests · **pytest** direct-mode contract tests
- **Vercel** hosting

> Stack note: the brief suggested Next.js + TypeScript; this MVP ships the proven React + Vite + JS stack from the codebase it evolved from, to keep one battle-tested architecture. The data layer is modular (`src/genlayer.js`) so a Next.js port is mechanical.

## Local development

```bash
# contract
python3.12+ -m venv .venv && source .venv/bin/activate   # 3.12+ required by SDK types
pip install -r requirements.txt
genvm-lint check contracts/WorkProof.py --json
pytest tests/direct/ -v

# frontend
cd frontend && npm install
npm test        # 29 unit + DOM interaction tests
npm run smoke   # live read-only check
npm run dev
```

Set the deployed contract address in `frontend/src/genlayer.js` (`CONTRACT_ADDRESS`).

## End-to-end scripts

```bash
cd frontend
SMOKE_PRIVATE_KEY=0x... node scripts/e2e-lifecycle.mjs  # full lifecycle incl. live AI verification
SMOKE_PRIVATE_KEY=0x... node scripts/e2e-wallet.mjs     # injected-wallet signing path
```

## Deployment

- **Contract:** `genlayer deploy --contract contracts/WorkProof.py` (StudioNet is gasless; 0 GEN balance is fine)
- **Frontend:** `cd frontend && vercel deploy --prod`

## Security considerations & limitations

- Acceptance criteria are locked once a freelancer accepts; only the client can set them, and only while the contract is OPEN.
- Double settlement is impossible: verification transitions SUBMITTED→PAID/FAILED exactly once; disputes require FAILED state and resolve exactly once.
- Evidence is capped at 3 URLs, truncated per URL — very large evidence sets should be aggregated behind one URL.
- Deadlines are stored for display and client-side guardrails; on-chain time enforcement awaits a verified clock API (documented limitation).
- Direct-mode tests note: a reverted `verify_work` leaves the `VERIFYING` marker in direct mode (no tx rollback in the in-memory runner). Real consensus applies no state on failed execution; the safety property (no funds move) is asserted in tests.
- Demo mode is fully client-side and labeled; it never mixes with chain state.

## Known limitations

- GEN-only escrow (native value); token escrow awaits cross-contract token standards.
- Reputation module is stubbed (`readReputation` reserved) — no fake scores are shown.
- StudioNet RPC occasionally serves stale contract schemas to the SDK encoder; keeping `post_contract` at 3 positional args sidesteps it (see git history for the saga).
