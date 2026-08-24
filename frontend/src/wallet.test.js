import { describe, it, expect } from 'vitest';
import {
  encryptToKeystore,
  decryptKeystore,
  normalizePrivateKey,
} from './wallet.js';

const KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('keystore encryption', () => {
  it('roundtrips encrypt → decrypt', async () => {
    const ks = await encryptToKeystore(KEY, 's3cret password!');
    expect(ks.format).toBe('gl-keystore');
    expect(ks.ciphertext).not.toContain(KEY.slice(2));
    const back = await decryptKeystore(ks, 's3cret password!');
    expect(back).toBe(KEY);
  });

  it('produces different ciphertexts for the same input', async () => {
    const a = await encryptToKeystore(KEY, 'pw');
    const b = await encryptToKeystore(KEY, 'pw');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
  });

  it('rejects a wrong password', async () => {
    const ks = await encryptToKeystore(KEY, 'right');
    await expect(decryptKeystore(ks, 'wrong')).rejects.toThrow(
      /Wrong password/
    );
  });

  it('rejects foreign formats', async () => {
    await expect(decryptKeystore({ foo: 1 }, 'pw')).rejects.toThrow(
      /Unrecognized/
    );
  });
});

describe('normalizePrivateKey', () => {
  it('accepts 0x-prefixed and bare hex, lowercases', () => {
    expect(normalizePrivateKey(KEY)).toBe(KEY);
    expect(normalizePrivateKey(KEY.slice(2).toUpperCase())).toBe(KEY);
  });

  it('rejects short or non-hex input', () => {
    expect(() => normalizePrivateKey('1234')).toThrow(/64 hex/);
    expect(() => normalizePrivateKey('zz'.repeat(32))).toThrow(/64 hex/);
    expect(() => normalizePrivateKey('')).toThrow(/64 hex/);
  });
});
