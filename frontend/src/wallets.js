// EIP-6963 multi-wallet discovery + injected-provider connection helpers.
// Detects every installed wallet that announces itself (MetaMask, Rabby,
// Phantom EVM, Brave, Coinbase Wallet, ...) and falls back to legacy
// window.ethereum. Pure helpers are exported for testing.

export function newProviderRegistry() {
  const announced = [];
  const onAnnounce = (event) => {
    const detail = event.detail;
    if (!detail || !detail.info || !detail.provider) return;
    if (announced.some((p) => p.info.uuid === detail.info.uuid)) return;
    announced.push(detail);
  };
  return {
    announced,
    start() {
      window.addEventListener('eip6963:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    },
    stop() {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    },
    async settle(ms = 450) {
      await new Promise((r) => setTimeout(r, ms));
      return [...announced];
    },
  };
}

export function walletOptions(announced) {
  const options = announced.map((d) => ({
    kind: 'eip6963',
    id: d.info.rdns,
    name: d.info.name,
    icon: d.info.icon,
    provider: d.provider,
  }));
  if (options.length === 0 && typeof window !== 'undefined' && window.ethereum) {
    options.push({
      kind: 'legacy',
      id: 'window.ethereum',
      name: window.ethereum.isMetaMask
        ? 'MetaMask'
        : window.ethereum.isRabby
          ? 'Rabby'
          : 'Browser wallet',
      icon: null,
      provider: window.ethereum,
    });
  }
  return options;
}

export const INSTALL_LINKS = [
  { name: 'MetaMask', url: 'https://metamask.io/download/' },
  { name: 'Rabby', url: 'https://rabby.io/' },
  { name: 'Phantom', url: 'https://phantom.app/download' },
];

export async function connectProvider(provider) {
  const accounts = await provider.request({
    method: 'eth_requestAccounts',
  });
  const address = accounts && accounts[0];
  if (!address) throw new Error('Wallet returned no accounts');
  return address;
}

// ---- session persistence (no secrets — only which wallet to reconnect) ----

const SESSION_KEY = 'wp_wallet_session';

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || (s.kind !== 'eip6963' && s.kind !== 'legacy')) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

// Silent reconnect: eth_accounts (no popup) only succeeds if the user
// already granted access to this site. Returns address or null.
export async function silentConnect(provider) {
  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    return accounts && accounts[0] ? accounts[0] : null;
  } catch {
    return null;
  }
}

// Find the saved wallet among EIP-6963 announcements / legacy fallback.
export function pickProvider(session, announced) {
  if (!session) return null;
  if (session.kind === 'eip6963') {
    const match = announced.find((d) => d.info.rdns === session.rdns);
    if (match) {
      return { kind: 'eip6963', name: match.info.name, provider: match.provider };
    }
    return null;
  }
  if (session.kind === 'legacy' && typeof window !== 'undefined' && window.ethereum) {
    return {
      kind: 'legacy',
      name: window.ethereum.isMetaMask
        ? 'MetaMask'
        : window.ethereum.isRabby
          ? 'Rabby'
          : 'Browser wallet',
      provider: window.ethereum,
    };
  }
  return null;
}

export function shortAddr(a, lead = 6, tail = 4) {
  if (!a) return '';
  const s = String(a);
  if (s.length <= lead + tail + 2) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}
