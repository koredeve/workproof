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

export function shortAddr(a, lead = 6, tail = 4) {
  if (!a) return '';
  const s = String(a);
  if (s.length <= lead + tail + 2) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}
