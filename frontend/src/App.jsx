import React, { useEffect, useMemo, useState } from 'react';
import {
  makeClient,
  CONTRACT_ADDRESS,
  ASSISTANT_ADDRESS,
  EXPLORER_URL,
  STATUS,
  listContractIds,
  readContractState,
  readCredit,
  writeAndWait,
  parseCriteriaVerdict,
  draftCriteria,
  getDraft,
  getReceipt,
} from './genlayer.js';
import { useHashRoute, parseRoute, navigate } from './router.js';

function writeAndWaitRaw(client, fn, args, value) {
  return client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: fn,
    args,
    ...(value !== undefined ? { value } : {}),
  });
}

async function waitReceipt(client, hash) {
  await client.waitForTransactionReceipt({ hash, retries: 400 });
}
import {
  GEN,
  toGen,
  truncateHash,
  statusClass,
  statusBadge,
  explorerAddressUrl,
  explorerTxUrl,
  newContractId,
  sameAddr,
  isValidUrl,
  computeStats,
} from './lib.js';
import WalletModal from './WalletModal.jsx';
import { DEMO_CONTRACT, DEMO_STEPS } from './demo.js';
import './styles.css';

const TX_STAGES = ['Preparing', 'Wallet confirmation', 'Submitted', 'Processing', 'Confirmed'];

function TxBanner({ tx, onClose }) {
  // tx: { stage: 0..4 | 'failed', label, hash, error }
  const idx = tx.stage === 'failed' ? -1 : tx.stage;
  return (
    <div className={'notice' + (tx.stage === 'failed' ? ' failed' : '')} role="status" aria-live="polite">
      <div className="txstages" aria-hidden="true">
        {TX_STAGES.map((s, i) => (
          <span key={s} className={'txstage' + (i < idx ? ' done' : i === idx ? ' active' : '') + (tx.stage === 'failed' && i === 4 ? ' failed' : '')}>
            {tx.stage === 'failed' && i === 4 ? 'Failed' : s}
          </span>
        ))}
      </div>
      {tx.label && <strong>{tx.label}</strong>}
      {tx.hash && (
        <span className="txline">
          tx <a href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer">{truncateHash(tx.hash)}</a>
          {' · '}
          <a href={'#/transactions/' + tx.hash}>details</a>
        </span>
      )}
      {tx.error && (
        <details className="txerr">
          <summary>View technical details</summary>
          <code>{tx.error}</code>
        </details>
      )}
      <button className="linkish" onClick={onClose}>dismiss</button>
    </div>
  );
}

const VERIFICATION_STEPS = [
  { key: 'leader', label: 'Leader proposal' },
  { key: 'evidence', label: 'Evidence retrieval' },
  { key: 'criteria', label: 'Criteria evaluation' },
  { key: 'review', label: 'Validator review' },
  { key: 'consensus', label: 'Consensus' },
  { key: 'state', label: 'Contract state update' },
];

function VerificationPipeline({ status }) {
  // Conceptual pipeline visualization — the chain exposes outcomes, not
  // per-validator internals, so stage progress is derived from status.
  const reached =
    status === 'VERIFYING' ? 3 :
    ['PAID', 'FAILED', 'DISPUTED', 'REFUNDED'].includes(status) ? 6 :
    status === 'SUBMITTED' ? 1 : 0;
  return (
    <div className="pipeline" aria-label="Verification pipeline (conceptual)">
      {VERIFICATION_STEPS.map((s, i) => (
        <div key={s.key} className={'pstep' + (i < reached ? ' done' : '') + (status === 'VERIFYING' && i === reached ? ' active' : '')}>
          <span className="pdot" />
          <span className="plabel">{s.label}</span>
          {i < VERIFICATION_STEPS.length - 1 && <span className="pline" />}
        </div>
      ))}
      <p className="hint" style={{ marginTop: 8 }}>
        Conceptual visualization — validator-level internals are not exposed by the chain;
        outcomes and per-criterion results are read directly from contract state.
      </p>
    </div>
  );
}

function CriterionResults({ verdictJson, criteria }) {
  const results = parseCriteriaVerdict(verdictJson);
  if (results.length === 0) return null;
  const byIndex = new Map(results.map((r) => [r.index, r]));
  return (
    <div className="critresults">
      {criteria.map((text, i) => {
        const r = byIndex.get(i + 1);
        const cls = r ? (r.result === 'PASS' ? 'ok' : r.result === 'FAIL' ? 'warn' : '') : '';
        return (
          <div key={i} className={'critrow ' + cls}>
            <span className={'critbadge ' + cls}>{r ? r.result : '—'}</span>
            <div>
              <div className="crittext">{text}</div>
              {r?.reason && <div className="critreason">{r.reason}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AmendmentBox({ c, onAction, busy }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (c.amendment_pending) {
    return (
      <div className="submitbox">
        <p className="hint">An amendment is pending — awaiting freelancer approval.</p>
        {sameAddr(me, c.freelancer) && (
          <button className="btn-stamp" disabled={!!busy}
            onClick={() => onAction('approve_amendment', [c.id], 'Amendment approved — criteria updated.')}>
            Approve amendment
          </button>
        )}
      </div>
    );
  }
  if (!open) {
    return <button className="ghost" style={{ marginTop: 0 }} onClick={() => setOpen(true)}>Propose criteria amendment</button>;
  }
  return (
    <div className="submitbox">
      <p className="hint">Propose revised criteria. Takes effect only when the freelancer approves — criteria are never changed unilaterally.</p>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'One criterion per line, e.g.\nLanding page is publicly accessible\nPricing section present'} />
      <div className="row">
        <button className="btn-stamp" disabled={!!busy || !text.trim()}
          onClick={() => onAction('propose_amendment', [c.id, text.split('\n').map((x) => x.trim()).filter(Boolean)], 'Amendment proposed — awaiting freelancer approval.')}>
          Propose amendment
        </button>
        <button className="ghost" style={{ marginTop: 0 }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function RateBox({ c, onAction, busy }) {
  const [rating, setRating] = useState(0);
  return (
    <div className="submitbox">
      <p className="hint">Rate this collaboration — ratings form the freelancer's on-chain reputation.</p>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={'chip' + (rating >= n ? ' on' : '')}
            onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
        ))}
        <button className="btn-stamp" disabled={!rating || !!busy}
          onClick={() => onAction('rate_contract', [c.id, rating], 'Rating recorded on-chain.')}>
          Submit rating
        </button>
      </div>
    </div>
  );
}

function ContractCard({ c, expanded, onToggle, client, me, onAction, busy, demo }) {
  const isClient = sameAddr(me, c.client);
  const isWorker = sameAddr(me, c.freelancer);
  const [deliverableUrls, setDeliverableUrls] = useState('https://\nhttps://');
  const [explanation, setExplanation] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [confirmCriteria, setConfirmCriteria] = useState(false);

  const evidenceUrls = deliverableUrls
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean);

  const submitDisabled =
    busy ||
    !explanation.trim() ||
    evidenceUrls.length === 0 ||
    evidenceUrls.some((u) => !isValidUrl(u));

  const actions = [];
  if (demo) {
    actions.push(<span key="demo" className="tag">demo — read only</span>);
  } else {
    if (c.status === STATUS.OPEN && me && !isClient) {
      actions.push(
        <button key="acc" className="btn-stamp" disabled={!!busy}
          onClick={() => onAction('accept_contract', [c.id], 'Contract accepted. You can now submit work.')}>
          Accept contract
        </button>
      );
    }
    if (c.status === STATUS.ACCEPTED && isWorker) {
      actions.push(
        <div key="sub" className="submitbox">
          <p className="hint">Submit evidence relevant to the contractual criteria. One URL per line (max 3) — validators will retrieve them.</p>
          <textarea
            rows={3}
            value={deliverableUrls}
            onChange={(e) => setDeliverableUrls(e.target.value)}
            placeholder={'https://deployment.example.com\nhttps://github.com/you/project'}
          />
          <textarea
            rows={2}
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Explain how the submitted evidence satisfies the criteria"
          />
          <button className="btn-stamp" disabled={submitDisabled}
            onClick={() => onAction('submit_work', [c.id, evidenceUrls, explanation.trim()], 'Work submitted — verification can begin.')}>
            Submit work &amp; evidence
          </button>
        </div>
      );
    }
    if (c.status === STATUS.SUBMITTED && (isClient || isWorker || me)) {
      actions.push(
        <button key="ver" className="btn-stamp" disabled={!!busy}
          onClick={() => onAction('verify_work', [c.id], 'Verification complete — result recorded on-chain.')}>
          {busy ? 'Validators retrieving evidence and judging criteria…' : 'Run GenLayer verification'}
        </button>
      );
    }
    if (c.status === STATUS.ACCEPTED && isClient && !demo) {
      actions.push(
        <AmendmentBox key="amend" c={c} client={client} me={me} onAction={onAction} busy={busy} />
      );
    }
    if (c.status === STATUS.PAID && isClient && !c.rated && !demo) {
      actions.push(
        <RateBox key="rate" c={c} onAction={onAction} busy={busy} />
      );
    }
    if (c.status === STATUS.FAILED && isClient) {
      actions.push(
        <div key="ref" className="row">
          <button className="btn-ghost" disabled={!!busy}
            onClick={() => onAction('refund_client', [c.id], 'Escrow refunded to you.')}>
            Refund escrow
          </button>
        </div>
      );
    }
    if (c.status === STATUS.FAILED && (isClient || isWorker)) {
      actions.push(
        <div key="dis" className="submitbox">
          <p className="hint">Open a dispute to have validators re-arbitrate under the original criteria. The criteria cannot be rewritten.</p>
          <input
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder="State the dispute reason (why the verification should be reconsidered)"
          />
          <button className="danger" disabled={!!busy || !disputeReason.trim()}
            onClick={() => onAction('open_dispute', [c.id, disputeReason.trim()], 'Dispute opened — arbitration can now run.')}>
            Open dispute
          </button>
        </div>
      );
    }
    if (c.status === STATUS.DISPUTED) {
      actions.push(
        <button key="res" className="btn-stamp" disabled={!!busy}
          onClick={() => onAction('resolve_dispute', [c.id], 'Dispute resolved — settlement recorded on-chain.')}>
          {busy ? 'Validators re-arbitrating under the original criteria…' : 'Resolve dispute'}
        </button>
      );
    }
    if (c.status === STATUS.OPEN && isClient) {
      actions.push(
        <button key="can" className="ghost" disabled={!!busy}
          onClick={() => onAction('cancel_open', [c.id], 'Contract cancelled and escrow refunded.')}>
          Cancel contract
        </button>
      );
    }
  }

  const verdict = parseCriteriaVerdict(c.verdict_criteria);

  return (
    <div className={'docket-row' + (demo ? ' demo-row' : '')}>
      {demo && <div className="demo-flag">DEMO — simulated data, not a blockchain transaction</div>}
      <button className="jobhead" onClick={onToggle} aria-expanded={expanded}>
        <span className={'jseal ' + statusClass(c.status)}>{statusBadge(c.status)}</span>
        <span className="jtitle">{c.title}</span>
        <span className="jid">{c.id}</span>
        <span className="jbudget">{toGen(c.budget_atto)} GEN</span>
      </button>
      {expanded && (
        <div className="jbody">
          <p className="desc">{c.description}</p>

          <div>
            <span className="sectlabel">Acceptance criteria</span>
            <ol className="critlist">
              {c.criteria.map((cr, i) => (
                <li key={i}>{cr}</li>
              ))}
            </ol>
            {c.criteria.length === 0 && <p className="hint">Client has not published criteria yet.</p>}
          </div>

          {c.deadline && (
            <div className="parties">
              <div><span className="hint">deadline</span> {c.deadline}</div>
            </div>
          )}

          <div className="parties">
            <div>
              <span className="hint">client</span>
              {demo ? <span className="mono">{truncateHash(c.client, 8, 6)}</span> : (
                <a className="mono" href={explorerAddressUrl(c.client)} target="_blank" rel="noreferrer">
                  {truncateHash(c.client, 8, 6)}
                </a>
              )}
            </div>
            {c.freelancer && (
              <div>
                <span className="hint">freelancer</span>
                {demo ? <span className="mono">{truncateHash(c.freelancer, 8, 6)}</span> : (
                  <a className="mono" href={explorerAddressUrl(c.freelancer)} target="_blank" rel="noreferrer">
                    {truncateHash(c.freelancer, 8, 6)}
                  </a>
                )}
              </div>
            )}
            <div>
              <span className="hint">escrow</span>
              <strong>{toGen(c.budget_atto)} GEN</strong>{' '}
              <span className="hint">
                {['OPEN', 'ACCEPTED', 'SUBMITTED', 'VERIFYING', 'DISPUTED', 'FAILED'].includes(c.status) ? 'LOCKED' : c.status === 'PAID' ? 'RELEASED' : 'RETURNED'}
              </span>
            </div>
          </div>

          {(c.explanation || c.evidence_urls.length > 0) && (
            <div>
              <span className="sectlabel">Submission</span>
              <p className="deliverable">{c.explanation}</p>
              {c.evidence_urls.map((u, i) => (
                <p key={i} className="evidencelink">
                  {demo ? <span className="mono">{u}</span> : (
                    <a className="mono" href={u} target="_blank" rel="noreferrer">{u}</a>
                  )}
                </p>
              ))}
            </div>
          )}

          {['VERIFYING', 'PAID', 'FAILED', 'DISPUTED', 'REFUNDED'].includes(c.status) && (
            <div>
              <span className="sectlabel">GenLayer verification</span>
              <VerificationPipeline status={c.status} />
              {verdict.length > 0 && (
                <div className="critresults">
                  <div className="vhead">
                    <span>Result: <strong className={c.verdict_overall === 'PASSED' ? 'ok' : 'warn'}>{c.verdict_overall}</strong></span>
                    <span className="count">{verdict.filter((v) => v.result === 'PASS').length} / {c.criteria.length} criteria satisfied</span>
                  </div>
                  <CriterionResults verdictJson={c.verdict_criteria} criteria={c.criteria} />
                  {c.verdict_reasoning && (
                    <p className="ruling"><span className="hint">evaluator reasoning</span>{c.verdict_reasoning}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {c.dispute_reason && (
            <p className="deliverable"><span className="hint">dispute reason</span>{c.dispute_reason}</p>
          )}
          {c.amendment_pending && (
            <p className="deliverable"><span className="hint">amendment proposed — awaiting freelancer approval</span>
              {(() => { try { return JSON.parse(c.amendment_pending).join(' · '); } catch { return c.amendment_pending; } })()}
            </p>
          )}
          {c.rated && <p className="hint">client rating: {stars(c.rating)}</p>}

          {actions.length > 0 && <div className="actions">{actions}</div>}
          {c.status === STATUS.OPEN && isClient && !demo && (
            <button className="ghost" disabled={!!busy}
              onClick={() => onAction('cancel_open', [c.id], 'Contract cancelled and escrow refunded.')}>
              Cancel contract
            </button>
          )}
          {c.status === STATUS.OPEN && !confirmCriteria && isClient && (
            <p className="hint">Add at least one criterion before a freelancer can accept.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CreateView({ client, me, onPosted }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('1');
  const [deadline, setDeadline] = useState('');
  const [criteria, setCriteria] = useState(['', '']);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid =
    title.trim() && description.trim() && parseFloat(budget) >= 0.1 &&
    criteria.filter((c) => c.trim()).length >= 1 && confirmed;

  async function post() {
    setBusy(true);
    setError('');
    try {
      const id = newContractId();
      const hash = await writeAndWait(
        client,
        'post_contract',
        [id, title.trim(), description.trim()],
        GEN(parseFloat(budget))
      );
      const clean = criteria.map((c) => c.trim()).filter(Boolean);
      await writeAndWait(client, 'set_criteria', [id, clean]);
      if (deadline) {
        const ts = Math.floor(new Date(deadline + 'T23:59:59Z').getTime() / 1000);
        await writeAndWait(client, 'set_deadline', [id, ts]);
      }
      onPosted(id, hash);
      setTitle(''); setDescription(''); setBudget('1'); setDeadline('');
      setCriteria(['', '']); setConfirmed(false); setPreview(false);
    } catch (e) {
      setError('Posting failed: ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="create">
      <h2>Create a work contract <span className="tag">escrowed on posting</span></h2>
      {!me && <p className="hint">Connect a wallet first — the escrow is funded from your wallet when you post.</p>}
      <div className="row">
        <input style={{ flex: 2 }} placeholder="Contract title (e.g. Build SaaS landing page)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input style={{ flex: 1, maxWidth: 150 }} placeholder="Budget GEN" value={budget} onChange={(e) => setBudget(e.target.value)} />
        <input style={{ flex: 1, maxWidth: 180 }} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input style={{ flex: 3 }} placeholder="Describe the work — scope, deliverables, context" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div style={{ marginTop: 14 }}>
        <span className="sectlabel">Acceptance criteria — the heart of the contract</span>
        <p className="hint" style={{ marginTop: 4 }}>
          Each criterion must be objectively checkable from the submitted evidence. Validators
          score every criterion PASS / FAIL / UNVERIFIABLE and the escrow settles on the result.
        </p>
        {criteria.map((c, i) => (
          <div key={i} className="row" style={{ marginTop: 6 }}>
            <span className="critnum">{i + 1}.</span>
            <input
              style={{ flex: 3 }}
              placeholder={`Criterion ${i + 1} (e.g. Landing page is publicly accessible at the submitted URL)`}
              value={c}
              onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {criteria.length > 1 && (
              <button className="ghost" style={{ marginTop: 0 }}
                onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button className="ghost" style={{ marginTop: 8 }}
          onClick={() => setCriteria([...criteria, ''])}>
          Add criterion
        </button>
      </div>

      <label className="confirmrow">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I understand that these criteria will be used to evaluate the submitted work and that they cannot be changed after a freelancer accepts.</span>
      </label>

      {error && <div className="error">{error}</div>}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn-ghost" disabled={!valid} onClick={() => setPreview(!preview)}>
          {preview ? 'Hide preview' : 'Preview contract'}
        </button>
        <button className="btn-stamp" disabled={!valid || preview || busy} onClick={post}>
          {busy ? 'Posting…' : `Post contract & fund ${budget} GEN escrow`}
        </button>
      </div>

      {preview && (
        <div className="verdict" style={{ marginTop: 14 }}>
          <div className="vlabel"><span>Contract preview</span><span className="vseal">Draft</span></div>
          <div className="vbody">
            <strong>{title}</strong>
            <p>{description}</p>
            <span className="sectlabel">Criteria</span>
            <ol className="critlist">
              {criteria.filter((c) => c.trim()).map((c, i) => <li key={i}>{c}</li>)}
            </ol>
            <p className="hint">
              Budget {budget} GEN · {deadline ? `deadline ${deadline}` : 'no deadline set'} ·
              verification by GenLayer validator consensus
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileView({ contracts, me, credit }) {
  if (!me) {
    return (
      <section className="card">
        <h2>Profile</h2>
        <p className="hint">Connect a wallet to see your on-chain history.</p>
      </section>
    );
  }
  const mine = contracts.filter((c) => sameAddr(me, c.client) || sameAddr(me, c.freelancer));
  const created = mine.filter((c) => sameAddr(me, c.client)).length;
  const settled = mine.filter((c) => ['PAID', 'FAILED', 'REFUNDED'].includes(c.status));
  const successful = mine.filter((c) => c.status === 'PAID' && sameAddr(me, c.freelancer)).length;
  const rate = settled.length ? Math.round((successful / settled.length) * 100) : null;
  const stats = computeStats(mine, credit, me);
  return (
    <section className="card">
      <h2>Profile <span className="tag">derived from on-chain history</span></h2>
      <div className="parties" style={{ marginBottom: 12 }}>
        <div><span className="hint">wallet</span> <span className="mono">{me}</span></div>
        <div><span className="hint">withdrawable</span> <strong>{credit} GEN</strong></div>
      </div>
      <div className="statsgrid">
        <div className="statcard"><div className="statvalue">{created}</div><div className="statlabel">Contracts created</div></div>
        <div className="statcard"><div className="statvalue">{stats.completed}</div><div className="statlabel">Completed</div></div>
        <div className="statcard"><div className="statvalue">{rate === null ? '—' : rate + '%'}</div><div className="statlabel">Verification success rate</div></div>
        <div className="statcard"><div className="statvalue">{mine.filter((c) => c.status === 'DISPUTED').length}</div><div className="statlabel">Disputes</div></div>
        <div className="statcard"><div className="statvalue">{stats.earnings}</div><div className="statlabel">Earnings (GEN)</div></div>
        <div className="statcard"><div className="statvalue">{stats.spending}</div><div className="statlabel">Spending (GEN)</div></div>
      </div>
      {mine.length === 0 && <p className="hint" style={{ marginTop: 10 }}>No contracts involve this wallet yet.</p>}
    </section>
  );
}

function TxExplorer({ client, hash }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    getReceipt(client, hash)
      .then((r) => live && setReceipt(r))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [client, hash]);
  return (
    <section className="card">
      <h2>Transaction <span className="mono" style={{ fontSize: 12 }}>{truncateHash(hash, 14, 10)}</span></h2>
      <p className="hint">
        <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">Open in the block explorer</a>
      </p>
      {error && <p className="hint">Could not load this transaction: {error}</p>}
      {!receipt && !error && <div className="skeleton" />}
      {receipt && (
        <table style={{ width: '100%', fontSize: 13 }}>
          <tbody>
            <tr><td style={{ color: 'var(--ink-2)', width: 160 }}>Status</td><td><strong>{receipt.status_name ?? String(receipt.status)}</strong></td></tr>
            <tr><td style={{ color: 'var(--ink-2)' }}>Result</td><td>{receipt.result_name ?? '—'}</td></tr>
            <tr><td style={{ color: 'var(--ink-2)' }}>Hash</td><td className="mono" style={{ wordBreak: 'break-all' }}>{String(receipt.hash ?? hash)}</td></tr>
            <tr><td style={{ color: 'var(--ink-2)' }}>From</td><td className="mono">{String(receipt.from_address ?? receipt.sender ?? '—')}</td></tr>
            <tr><td style={{ color: 'var(--ink-2)' }}>To</td><td className="mono">{String(receipt.to_address ?? receipt.recipient ?? '—')}</td></tr>
            <tr><td style={{ color: 'var(--ink-2)' }}>Value</td><td className="mono">{String(receipt.value ?? 0)}</td></tr>
          </tbody>
        </table>
      )}
    </section>
  );
}


const FAQS = [
  ["What is WorkProof?",
   "A trustless work verification and settlement protocol. Clients post work contracts with objective acceptance criteria and lock payment in escrow. Freelancers submit evidence. GenLayer's AI validators check the evidence against the criteria and the escrow settles on the result — no platform in the middle deciding who is right."],
  ["How is this different from Fiverr or Upwork?",
   "Those platforms ask you to trust a company's internal review team. WorkProof replaces that with published acceptance criteria, on-chain escrow, and independent AI validators that must reach consensus. Every ruling, and the reasoning behind it, is stored on-chain where anyone can inspect it."],
  ["How does verification actually work?",
   "When work is submitted, validators retrieve the evidence URLs from the live web, evaluate every acceptance criterion independently, and score each one PASS, FAIL, or UNVERIFIABLE. The overall result only settles when validators agree on the per-criterion outcomes. If evidence cannot be retrieved, the run is marked TRANSIENT and can be retried — nothing silently passes."],
  ["What do PASS, FAIL and UNVERIFIABLE mean?",
   "PASS — the retrieved evidence demonstrates the criterion is met. FAIL — the evidence shows it is not met. UNVERIFIABLE — the evidence was insufficient to decide either way. A contract is PAID only when no criterion fails and at most one is unverifiable."],
  ["Can the client change the criteria after I start working?",
   "No. Criteria are locked the moment a freelancer accepts. The only way they change is a mutual amendment: the client proposes, the freelancer explicitly approves. Neither party can change criteria unilaterally."],
  ["What happens if verification fails?",
   "The escrow stays locked — nothing is released. The client can refund themselves, or either party can open a dispute. A dispute is re-arbitrated strictly under the original criteria, which the arbitrator cannot rewrite. The outcome is either PAID (freelancer) or REFUNDED (client)."],
  ["Is my wallet safe here?",
   "Your keys never leave your wallet. Every transaction requires your explicit approval popup, and the app only ever asks your wallet to interact with the two WorkProof contracts. There are no token approvals (escrow uses the native GEN token), no signature harvesting, and the contract has no admin function that can move your escrow."],
  ["Who owns the escrow while work is in progress?",
   "The contract itself. The budget is locked at creation and can only move along fixed paths: release to the freelancer on verified success, refund to the client on failure, cancellation, or expiry. The protocol owner cannot touch it."],
  ["Do I need GEN to participate?",
   "You need GEN only to fund a contract's escrow when posting. Accepting, submitting evidence, verifying, disputing and rating are free — the network covers transaction fees. StudioNet is gasless: a 0 GEN balance still lets you work."],
  ["Is this real money?",
   "No — this deployment runs on StudioNet, GenLayer's test network. GEN here is a test token with no monetary value. The mechanics are identical to what a mainnet deployment would use."],
  ["What are the deadlines?",
   "Clients can set a deadline when creating a contract. It is enforced on-chain: submissions after the deadline revert, and anyone can trigger an automatic refund of an expired contract that was never started."],
  ["Can I be both the client and the freelancer?",
   "No — a contract requires two different addresses. That separation is what makes independent verification meaningful."],
  ["What is the protocol fee?",
   "A small fee, capped at 10% and visible in the contract code, is deducted from the freelancer's payout when a contract settles successfully. Refunds are never charged a fee."],
  ["Can I use this on my phone?",
   "Yes. The interface is fully responsive — browsing, accepting, submitting evidence and verifying all work on mobile with wallet apps like MetaMask and Rabby."],
  ["What is the demo mode?",
   "The Dashboard offers a demo contract that walks through the full lifecycle with simulated data. It is clearly labeled DEMO at every step and is never mixed with real blockchain state."],
  ["What if I still have a problem?",
   "Every action shows its transaction hash — click details to open the transaction view, or the block explorer, and share that hash. On-chain state is the source of truth: if the contract shows PAID, the payment happened; if it shows FAILED, the escrow is still locked."],
];

function FAQ() {
  return (
    <section className="card" id="faq">
      <h2>Frequently asked questions</h2>
      <div className="faq">
        {FAQS.map(([q, a]) => (
          <details key={q} className="faqitem">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Dashboard({ contracts, me, credit, onOpenDemo, demoOpen }) {
  const stats = useMemo(() => computeStats(contracts, credit, me), [contracts, credit, me]);
  const cards = [
    ['Total contracts', stats.total],
    ['Active', stats.active],
    ['Pending verification', stats.verifying],
    ['Disputed', stats.disputed],
    ['Completed', stats.completed],
    ['Value locked', `${stats.totalLocked} GEN`],
    ['Withdrawable', `${stats.withdrawable} GEN`],
  ];
  return (
    <section className="card" id="dashboard">
      <h2>Dashboard <span className="tag">{me ? 'your wallet' : 'connect wallet for personal stats'}</span></h2>
      <div className="statsgrid">
        {cards.map(([label, value]) => (
          <div key={label} className="statcard">
            <div className="statvalue">{value}</div>
            <div className="statlabel">{label}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn-ghost" onClick={onOpenDemo} disabled={demoOpen}>
          {demoOpen ? 'Demo contract open below' : 'View demo contract'}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          Demo walks through the full flow with simulated data — clearly separated from chain state.
        </span>
      </div>
    </section>
  );
}

export default function App() {
  const route = useHashRoute();
  const parsed = parseRoute(route);
  const [client, setClient] = useState(() => makeClient(null));
  const [me, setMe] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [demoContracts, setDemoContracts] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [credit, setCredit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tx, setTx] = useState(null);
  const setStage = (stage, extra = {}) => setTx((t) => ({ ...(t ?? {}), stage, ...extra }));

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const ids = await listContractIds(client);
      const rows = [];
      for (const id of ids) {
        try {
          rows.push({ id, ...(await readContractState(client, id)) });
        } catch {
          rows.push({ id, status: 'unavailable' });
        }
      }
      setContracts(rows.reverse());
      if (me) {
        try {
          setCredit(toGen(await readCredit(client, me)));
        } catch {}
      }
    } catch (e) {
      setError('Failed to load contracts: ' + (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [me]);

  async function act(fn, args, doneMsg) {
    setBusy(fn + args.join('|'));
    setError('');
    setTx({ stage: 0, label: doneMsg });
    try {
      setStage(1);
      const hash = await writeAndWaitRaw(client, fn, args);
      setStage(2, { hash });
      setStage(3, { hash });
      await waitReceipt(client, hash);
      setStage(4, { hash, label: doneMsg });
      await refresh();
    } catch (e) {
      setTx({ stage: 'failed', label: fn + ' failed', error: String(e?.message ?? e) });
      setError('Your transaction could not be processed. Check the details below and try again.');
    } finally {
      setBusy('');
    }
  }

  const all = [...demoContracts, ...contracts];
  const openCount = contracts.filter((c) => c.status === STATUS.OPEN).length;

  return (
    <div className="wrap">
      <header>
        <div className="topbar">
          <a className="wordmark" href="#top">Work<em>Proof</em></a>
          <nav className="topnav">
            <button className={'navbtn' + (parsed.view === 'marketplace' ? ' on' : '')} onClick={() => navigate('/marketplace')}>Marketplace</button>
            <button className={'navbtn' + (parsed.view === 'create' ? ' on' : '')} onClick={() => navigate('/create')}>Create</button>
            <button className={'navbtn' + (parsed.view === 'dashboard' ? ' on' : '')} onClick={() => navigate('/dashboard')}>Dashboard</button>
            <button className={'navbtn' + (parsed.view === 'profile' ? ' on' : '')} onClick={() => navigate('/profile')}>Profile</button>
            <WalletModal
              me={me}
              onUnlock={(c, address) => {
                setClient(c);
                setMe(address);
              }}
              onLock={() => {
                setClient(makeClient(null));
                setMe(null);
                setCredit(0);
              }}
            />
          </nav>
        </div>

        {parsed.view === 'marketplace' && (
          <div className="hero" id="top">
            <div>
              <h1>
                Freelance work.<br />
                <span className="ruled">Verified by consensus.</span>
              </h1>
              <p className="lede">
                Create performance-based work contracts, lock payment in escrow, submit
                evidence, and let GenLayer independently adjudicate whether the agreed
                requirements were fulfilled.
              </p>
              <div className="hero-ctas">
                <button className="btn-stamp" onClick={() => navigate('/create')}>Create a Contract</button>
                <a className="btn-ghost" style={{ textDecoration: 'none', display: 'inline-block' }} href="#board">
                  Explore Work
                </a>
              </div>
            </div>
            <div className="verdict">
              <div className="vlabel">
                <span>Ruling · DEMO-GL-2048</span>
                <span className="vseal">Verified</span>
              </div>
              <p className="vbody">
                “All six acceptance criteria were verified against the retrieved deployment
                and repository evidence. Payment released automatically.”
              </p>
              <div className="vmeta">
                <span>500 GEN to freelancer</span>
                <span>final</span>
              </div>
              <div className="consensus">
                {[0, 1, 2, 3, 4].map((i) => <span key={i} className="tick on" />)}
                <span className="clabel">5/5 validators agreed</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {tx && <TxBanner tx={tx} onClose={() => setTx(null)} />}
      {error && <div className="error">{error}</div>}

      {parsed.view === 'create' && (
        <CreateView
          client={client}
          me={me}
          onPosted={(id, hash) => {
            setTx({ stage: 4, label: 'Contract posted, criteria recorded, escrow funded.', hash });
            navigate('/contracts/' + id);
            refresh();
          }}
        />
      )}

      {parsed.view === 'dashboard' && (
        <Dashboard
          contracts={contracts}
          me={me}
          credit={credit}
          demoOpen={demoContracts.length > 0}
          onOpenDemo={() => {
            setDemoContracts([DEMO_CONTRACT]);
            navigate('/contracts/DEMO-GL-2048');
          }}
        />
      )}

      {parsed.view === 'profile' && (
        <ProfileView contracts={contracts} me={me} credit={credit} />
      )}

      {parsed.view === 'tx' && (
        <TxExplorer client={client} hash={parsed.hash} />
      )}

      {parsed.view === 'contract' && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Contract detail</h2>
            <button className="btn-ghost" onClick={() => navigate('/marketplace')}>← Back to marketplace</button>
          </div>
          {loading ? (
            <div className="skeleton" />
          ) : (
            (() => {
              const c = all.find((x) => x.id === parsed.id);
              if (!c) return <p className="hint">Contract not found — it may be a demo contract; open it from the Dashboard, or refresh.</p>;
              return (
                <ContractCard
                  c={c}
                  demo={!!c.demo}
                  expanded={true}
                  onToggle={() => navigate('/marketplace')}
                  client={client}
                  me={me}
                  onAction={act}
                  busy={!!busy}
                />
              );
            })()
          )}
        </section>
      )}

      {parsed.view !== 'tx' && parsed.view !== 'profile' && parsed.view !== 'contract' && (
      <section className="card" id="board">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{parsed.view === 'dashboard' ? 'Recent contracts' : 'Open marketplace'} <span className="count">{contracts.length}</span></h2>
          <div className="chips">
            <button className="chip on">all ({contracts.length})</button>
            <button className="chip">open ({openCount})</button>
          </div>
        </div>
        {!me && parsed.view !== 'dashboard' && (
          <p className="hint">Connect a wallet to create, accept, or verify — browsing is open to everyone.</p>
        )}
        {loading ? (
          <div className="skeleton" />
        ) : all.length === 0 ? (
          <p className="hint">
            No active contracts yet. {me ? 'Create the first one from the Create tab.' : 'Connect a wallet to create the first one.'}
          </p>
        ) : (
          <div className="docket">
            {all.map((c) => (
              <ContractCard
                key={c.id}
                c={c}
                demo={!!c.demo}
                expanded={expanded === c.id || parsed.view === 'dashboard'}
                onToggle={() => navigate('/contracts/' + encodeURIComponent(c.id))}
                client={client}
                me={me}
                onAction={act}
                busy={!!busy}
              />
            ))}
          </div>
        )}
        <button className="ghost" onClick={refresh}>Refresh</button>
      </section>
      )}

      {parsed.view !== 'tx' && <FAQ />}

      <footer>
        <a href="https://github.com/koredeve/workproof" target="_blank" rel="noreferrer">source</a>
        <span>·</span>
        <a href={EXPLORER_URL} target="_blank" rel="noreferrer">contract</a>
        <span>·</span>
        <span>{truncateHash(CONTRACT_ADDRESS, 6, 4)} on StudioNet</span>
        <span>·</span>
        <span>WorkProof does not ask whether work is “good” — it checks evidence against the criteria both parties agreed to</span>
      </footer>
    </div>
  );
}
