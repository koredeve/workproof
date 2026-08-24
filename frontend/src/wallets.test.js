import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  newProviderRegistry,
  walletOptions,
  connectProvider,
  silentConnect,
  pickProvider,
  saveSession,
  loadSession,
  clearSession,
  shortAddr,
  INSTALL_LINKS,
} from './wallets.js';

function fakeWindow(ethereum) {
  const listeners = {};
  const win = {
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete listeners[name];
    },
    dispatchEvent: (event) => {
      if (event.type === 'eip6963:requestProvider' && ethereum) {
        ethereum.forEach((detail) =>
          listeners['eip6963:announceProvider']({ detail })
        );
      }
      return true;
    },
  };
  if (ethereum) win.ethereum = ethereum.ethereum ?? ethereum;
  return win;
}

const metamaskDetail = {
  info: { uuid: 'u1', name: 'MetaMask', icon: 'data:image/x', rdns: 'io.metamask' },
  provider: { request: vi.fn() },
};
const rabbyDetail = {
  info: { uuid: 'u2', name: 'Rabby', icon: 'data:image/x', rdns: 'io.rabby' },
  provider: { request: vi.fn() },
};

describe('EIP-6963 discovery', () => {
  it('collects announced wallets and dedupes by uuid', async () => {
    const win = fakeWindow([metamaskDetail, rabbyDetail, metamaskDetail]);
    const saved = global.window;
    global.window = win;
    const reg = newProviderRegistry();
    reg.start();
    const found = await reg.settle(10);
    global.window = saved;
    expect(found.map((f) => f.info.name)).toEqual(['MetaMask', 'Rabby']);
  });

  it('walletOptions maps announced wallets', () => {
    const win = fakeWindow(null);
    const saved = global.window;
    global.window = win;
    const opts = walletOptions([metamaskDetail]);
    global.window = saved;
    expect(opts[0].name).toBe('MetaMask');
    expect(opts[0].kind).toBe('eip6963');
    expect(typeof opts[0].provider.request).toBe('function');
  });

  it('falls back to legacy window.ethereum when nothing announces', () => {
    const win = fakeWindow({ ethereum: { isMetaMask: true, request: vi.fn() } });
    const saved = global.window;
    global.window = win;
    const opts = walletOptions([]);
    global.window = saved;
    expect(opts.length).toBe(1);
    expect(opts[0].name).toBe('MetaMask');
    expect(opts[0].kind).toBe('legacy');
  });
});

describe('connectProvider', () => {
  it('returns the first account', async () => {
    const provider = {
      request: vi.fn().mockResolvedValue(['0xabc', '0xdef']),
    };
    expect(await connectProvider(provider)).toBe('0xabc');
    expect(provider.request).toHaveBeenCalledWith({
      method: 'eth_requestAccounts',
    });
  });

  it('throws when the wallet returns no accounts', async () => {
    const provider = { request: vi.fn().mockResolvedValue([]) };
    await expect(connectProvider(provider)).rejects.toThrow(/no accounts/);
  });
});

describe('session persistence', () => {
  beforeEach(() => localStorage.clear());

  it('saves, loads and clears a session', () => {
    expect(loadSession()).toBe(null);
    saveSession({ kind: 'eip6963', rdns: 'io.metamask' });
    expect(loadSession()).toEqual({ kind: 'eip6963', rdns: 'io.metamask' });
    clearSession();
    expect(loadSession()).toBe(null);
  });

  it('rejects malformed sessions', () => {
    localStorage.setItem('wp_wallet_session', '{"kind":"weird"}');
    expect(loadSession()).toBe(null);
    localStorage.setItem('wp_wallet_session', 'not-json');
    expect(loadSession()).toBe(null);
  });

  it('silentConnect returns null when wallet grants nothing', async () => {
    const provider = { request: vi.fn().mockResolvedValue([]) };
    expect(await silentConnect(provider)).toBe(null);
    const p2 = { request: vi.fn().mockResolvedValue(['0xabc']) };
    expect(await silentConnect(p2)).toBe('0xabc');
  });

  it('pickProvider matches by rdns and falls back to legacy', () => {
    const picked = pickProvider({ kind: 'eip6963', rdns: 'io.rabby' }, [rabbyDetail, metamaskDetail]);
    expect(picked.name).toBe('Rabby');
    const saved = global.window;
    global.window = fakeWindow({ ethereum: { isMetaMask: true, request: vi.fn() } });
    const legacy = pickProvider({ kind: 'legacy' }, []);
    global.window = saved;
    expect(legacy.name).toBe('MetaMask');
    expect(pickProvider({ kind: 'eip6963', rdns: 'io.unknown' }, [metamaskDetail])).toBe(null);
  });
});

describe('misc', () => {
  it('shortAddr truncates', () => {
    expect(shortAddr('0x1234567890abcdef')).toBe('0x1234…cdef');
  });
  it('install links exist', () => {
    expect(INSTALL_LINKS.length).toBeGreaterThanOrEqual(2);
  });
});
