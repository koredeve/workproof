import React, { useEffect, useMemo, useState } from 'react';
import {
  makeClient,
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  STATUS,
  listContractIds,
  readContractState,
  readCredit,
  writeAndWait,
  parseCriteriaVerdict,
} from './genlayer.js';
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
      if (deadline) await writeAndWait(client, 'set_deadline', [id, deadline]);
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
  const [client, setClient] = useState(() => makeClient(null));
  const [me, setMe] = useState(null);
  const [view, setView] = useState('marketplace');
  const [contracts, setContracts] = useState([]);
  const [demoContracts, setDemoContracts] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [credit, setCredit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tx, setTx] = useState(null);

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
    try {
      const hash = await writeAndWait(client, fn, args);
      setTx({ label: doneMsg, hash });
      await refresh();
    } catch (e) {
      setError(fn + ' failed: ' + (e?.message ?? String(e)));
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
            <button className={'navbtn' + (view === 'marketplace' ? ' on' : '')} onClick={() => setView('marketplace')}>Marketplace</button>
            <button className={'navbtn' + (view === 'create' ? ' on' : '')} onClick={() => setView('create')}>Create</button>
            <button className={'navbtn' + (view === 'dashboard' ? ' on' : '')} onClick={() => setView('dashboard')}>Dashboard</button>
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

        {view === 'marketplace' && (
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
                <button className="btn-stamp" onClick={() => setView('create')}>Create a Contract</button>
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

      {tx && (
        <div className="notice">
          <strong>{tx.label}</strong>
          {tx.hash && (
            <span className="txline">
              tx <a href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer">{truncateHash(tx.hash)}</a>
            </span>
          )}
          <button className="linkish" onClick={() => setTx(null)}>dismiss</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {view === 'create' && (
        <CreateView
          client={client}
          me={me}
          onPosted={(id, hash) => {
            setTx({ label: 'Contract posted, criteria recorded, escrow funded.', hash });
            setView('marketplace');
            refresh();
          }}
        />
      )}

      {view === 'dashboard' && (
        <Dashboard
          contracts={contracts}
          me={me}
          credit={credit}
          demoOpen={demoContracts.length > 0}
          onOpenDemo={() => {
            setDemoContracts([DEMO_CONTRACT]);
            setExpanded('DEMO-GL-2048');
          }}
        />
      )}

      <section className="card" id="board">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{view === 'dashboard' ? 'Recent contracts' : 'Open marketplace'} <span className="count">{contracts.length}</span></h2>
          <div className="chips">
            <button className="chip on">all ({contracts.length})</button>
            <button className="chip">open ({openCount})</button>
          </div>
        </div>
        {!me && view !== 'dashboard' && (
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
                expanded={expanded === c.id}
                onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
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
