// Regression test for the FAUCET_ADDRESS class of bug: every exported binding
// must resolve at import time and every address constant must be valid.
import { describe, it, expect, vi } from 'vitest';

vi.mock('genlayer-js', () => ({ createClient: vi.fn(), createAccount: vi.fn() }));
vi.mock('genlayer-js/chains', () => ({ studionet: { id: 1 } }));

import {
  CONTRACT_ADDRESS,
  ASSISTANT_ADDRESS,
  FAUCET_ADDRESS,
  claimFaucet,
  faucetInfo,
  nextClaimAt,
  draftCriteria,
  getDraft,
} from './genlayer.js';

describe('module bindings resolve (no undefined references)', () => {
  it('exports valid addresses for every contract', () => {
    for (const [name, addr] of [
      ['CONTRACT_ADDRESS', CONTRACT_ADDRESS],
      ['ASSISTANT_ADDRESS', ASSISTANT_ADDRESS],
      ['FAUCET_ADDRESS', FAUCET_ADDRESS],
    ]) {
      expect(addr, `${name} must be defined`).toBeTruthy();
      expect(addr.startsWith('0x'), `${name} must be hex`).toBe(true);
      expect(addr.length, `${name} must be 42 chars`).toBe(42);
    }
    expect(CONTRACT_ADDRESS).not.toBe(ASSISTANT_ADDRESS);
    expect(FAUCET_ADDRESS).not.toBe(CONTRACT_ADDRESS);
  });

  it('faucet bindings execute without undefined references', async () => {
    const stub = { readContract: async () => ({ balance: '1' }), writeContract: async () => '0xh' };
    await expect(faucetInfo(stub)).resolves.toBeTruthy();
    await expect(nextClaimAt(stub, '0xabc')).resolves.toBeTruthy();
  });

  it('assistant bindings execute without undefined references', async () => {
    const stub = {
      readContract: async () => ({ title: 't' }),
      writeContract: async () => '0xh',
      waitForTransactionReceipt: async () => ({ status_name: 'ACCEPTED' }),
    };
    await expect(getDraft(stub, 'r1')).resolves.toBeTruthy();
    await expect(draftCriteria(stub, 'r2', 'brief')).resolves.toBe('0xh');
  });
});
