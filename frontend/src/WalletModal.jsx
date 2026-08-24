import React, { useEffect, useRef, useState } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import {
  newProviderRegistry,
  walletOptions,
  connectProvider,
  silentConnect,
  pickProvider,
  saveSession,
  loadSession,
  clearSession,
  INSTALL_LINKS,
  shortAddr,
} from './wallets.js';
import {
  encryptToKeystore,
  decryptKeystore,
  normalizePrivateKey,
  downloadKeystore,
} from './wallet.js';
import { generatePrivateKey, createAccount } from 'genlayer-js';

export default function WalletModal({ onUnlock, onLock, me }) {
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState([]);
  const [tab, setTab] = useState('detected'); // detected | local | advanced
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [file, setFile] = useState(null);
  const [rawKey, setRawKey] = useState('');
  const regRef = useRef(null);
  const restoredRef = useRef(false);

  // Silent reconnect on load: only works if the wallet still grants access.
  useEffect(() => {
    if (me || restoredRef.current) return;
    restoredRef.current = true;
    const session = loadSession();
    if (!session || session.kind !== 'eip6963' && session.kind !== 'legacy') return;
    const reg = newProviderRegistry();
    reg.start();
    reg.settle(700).then(async (found) => {
      const picked = pickProvider(session, found);
      reg.stop();
      if (!picked) {
        clearSession();
        return;
      }
      const address = await silentConnect(picked.provider);
      if (!address) {
        clearSession();
        return;
      }
      const c = createClient({
        chain: studionet,
        account: address,
        provider: picked.provider,
      });
      try {
        await c.connect('studionet');
      } catch {}
      onUnlock(c, address, 'wallet');
    });
  }, [me]);

  useEffect(() => {
    if (!open) return;
    setErr('');
    const reg = newProviderRegistry();
    regRef.current = reg;
    reg.start();
    reg.settle().then((found) => setDetected(walletOptions(found)));
    return () => reg.stop();
  }, [open]);

  function unlockWalletClient(address, provider, session) {
    const client = createClient({
      chain: studionet,
      account: address,
      provider,
    });
    if (session) saveSession(session);
    onUnlock(client, address, 'wallet');
    setOpen(false);
    setStatus('');
    setErr('');
  }

  async function connectOption(opt) {
    setBusy(opt.id);
    setErr('');
    setStatus(`Waiting for ${opt.name}…`);
    try {
      const address = await connectProvider(opt.provider);
      setStatus('Linking network…');
      const session =
        opt.kind === 'eip6963'
          ? { kind: 'eip6963', rdns: opt.id }
          : { kind: 'legacy' };
      const probe = createClient({
        chain: studionet,
        account: address,
        provider: opt.provider,
      });
      try {
        await probe.connect('studionet');
      } catch {
        /* user may decline network add — signing still works on StudioNet */
      }
      unlockWalletClient(address, opt.provider, session);
    } catch (e) {
      setErr(
        (e?.message ?? String(e)).slice(0, 160) || 'Connection cancelled'
      );
      setStatus('');
    } finally {
      setBusy('');
    }
  }

  async function connectLegacy() {
    if (typeof window === 'undefined' || !window.ethereum) return;
    await connectOption({
      kind: 'legacy',
      id: 'window.ethereum',
      name: window.ethereum.isMetaMask
        ? 'MetaMask'
        : window.ethereum.isRabby
          ? 'Rabby'
          : 'Browser wallet',
      provider: window.ethereum,
    });
  }

  function unlockLocal(pk) {
    const account = createAccount(pk);
    const client = createClient({ chain: studionet, account });
    onUnlock(client, account.address, 'local');
    setOpen(false);
    setPassword('');
    setPassword2('');
    setRawKey('');
    setFile(null);
    setErr('');
  }

  async function create() {
    if (password !== password2) {
      setErr('Passwords do not match');
      return;
    }
    setBusy('create');
    setErr('');
    try {
      const pk = normalizePrivateKey(generatePrivateKey());
      const ks = await encryptToKeystore(pk, password);
      unlockLocal(pk);
      downloadKeystore(ks, 'wallet');
    } catch (e) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile() {
    setBusy('import');
    setErr('');
    try {
      const text = await file.text();
      const pk = await decryptKeystore(JSON.parse(text), password);
      unlockLocal(normalizePrivateKey(pk));
    } catch (e) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  if (me) {
    return (
      <div className="walletchip">
        <span className="dot" />
        <span className="mono">{shortAddr(me)}</span>
        <button className="linkish" onClick={() => { clearSession(); onLock(); }}>Lock</button>
      </div>
    );
  }

  return (
    <>
      <button className="connect" onClick={() => setOpen(true)}>Connect Wallet</button>
      {open && (
        <div className="overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mtabs">
              <button className={tab === 'detected' ? 'on' : ''} onClick={() => setTab('detected')}>Wallets</button>
              <button className={tab === 'local' ? 'on' : ''} onClick={() => setTab('local')}>Local wallet</button>
              <button className={tab === 'advanced' ? 'on' : ''} onClick={() => setTab('advanced')}>Advanced</button>
              <button className="linkish closex" onClick={() => setOpen(false)}>✕</button>
            </div>

            {tab === 'detected' && (
              <div className="mbody">
                <p className="hint">
                  Your wallet signs every transaction — keys never leave it. GenLayer runs
                  alongside your wallet as its own chain.
                </p>
                {detected.length === 0 && (
                  <p className="hint">Scanning for installed wallets…</p>
                )}
                {detected.map((opt) => (
                  <button
                    key={opt.id}
                    className="walletrow"
                    onClick={() => connectOption(opt)}
                    disabled={!!busy}
                  >
                    {opt.icon ? (
                      <img src={opt.icon} alt="" width="28" height="28" />
                    ) : (
                      <span className="wicon">◉</span>
                    )}
                    <span className="wname">{opt.name}</span>
                    <span className="wdet">{busy === opt.id ? 'connecting…' : 'Detected'}</span>
                  </button>
                ))}
                {detected.length === 0 && typeof window !== 'undefined' && window.ethereum && (
                  <button className="walletrow" onClick={connectLegacy} disabled={!!busy}>
                    <span className="wicon">◉</span>
                    <span className="wname">Browser wallet</span>
                    <span className="wdet">{busy ? 'connecting…' : 'Detected'}</span>
                  </button>
                )}
                {detected.length === 0 && !(typeof window !== 'undefined' && window.ethereum) && (
                  <div className="install">
                    <p className="hint">No wallet detected. Install one to continue:</p>
                    <div className="row">
                      {INSTALL_LINKS.map((l) => (
                        <a key={l.name} className="installlink" href={l.url} target="_blank" rel="noreferrer">
                          Install {l.name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'local' && (
              <div className="mbody">
                <p className="hint">
                  Prefer not to use a browser wallet? Generate an app-local account,
                  encrypted in your browser (AES-GCM · PBKDF2 310k) with a downloadable backup.
                </p>
                <div className="row">
                  <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <input type="password" placeholder="Repeat password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
                  <button className="primary" disabled={password.length < 8 || busy === 'create'} onClick={create}>
                    {busy === 'create' ? 'Generating…' : 'Create wallet'}
                  </button>
                </div>
                <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <input type="file" accept="application/json" onChange={(e) => setFile(e.target.files[0] ?? null)} />
                  <input type="password" placeholder="Keystore password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button className="primary" disabled={!file || !password || busy === 'import'} onClick={importFile}>
                    {busy === 'import' ? 'Unlocking…' : 'Import backup'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'advanced' && (
              <div className="mbody">
                <p className="hint">Paste a raw private key. It stays in memory for this tab only.</p>
                <input type="password" placeholder="Private key (0x…)" value={rawKey} onChange={(e) => setRawKey(e.target.value)} />
                <button className="primary" disabled={!rawKey.trim()}
                  onClick={() => { try { unlockLocal(normalizePrivateKey(rawKey)); } catch (e) { setErr(e?.message ?? String(e)); } }}>
                  Connect
                </button>
              </div>
            )}

            {status && <div className="notice small">{status}</div>}
            {err && <div className="error">{err}</div>}
          </div>
        </div>
      )}
    </>
  );
}
