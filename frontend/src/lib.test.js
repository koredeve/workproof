import { describe, it, expect } from 'vitest';
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

describe('GEN conversions', () => {
  it('roundtrips', () => {
    expect(GEN(2.5)).toBe(2500000000000000000n);
    expect(toGen('2500000000000000000')).toBe(2.5);
    expect(toGen(undefined)).toBe(0);
  });
});

describe('status presentation', () => {
  it('maps on-chain states to spec badges', () => {
    expect(statusBadge('SUBMITTED')).toBe('WORK SUBMITTED');
    expect(statusBadge('FAILED')).toBe('VERIFICATION FAILED');
    expect(statusBadge('PAID')).toBe('PAID');
  });
  it('maps status classes', () => {
    expect(statusClass('PAID')).toBe('ok');
    expect(statusClass('VERIFYING')).toBe('live');
    expect(statusClass('DISPUTED')).toBe('warn');
  });
});

describe('validation helpers', () => {
  it('validates http(s) URLs only', () => {
    expect(isValidUrl('https://example.com/x')).toBe(true);
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });
  it('sameAddr is case-insensitive and null-safe', () => {
    expect(sameAddr('0xABC', '0xabc')).toBe(true);
    expect(sameAddr(null, '0xabc')).toBe(false);
  });
  it('newContractId is unique and prefixed GL-', () => {
    const a = newContractId();
    const b = newContractId();
    expect(a.startsWith('GL-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('dashboard stats', () => {
  const G = (n) => String(BigInt(n) * 10n ** 18n);
  const contracts = [
    { status: 'OPEN', budget_atto: G(1), client: '0xC', freelancer: '' },
    { status: 'VERIFYING', budget_atto: G(2), client: '0xC', freelancer: '0xF' },
    { status: 'PAID', budget_atto: G(3), client: '0xC', freelancer: '0xF' },
    { status: 'DISPUTED', budget_atto: G(4), client: '0xD', freelancer: '0xF' },
  ];
  it('computes counts and value locked', () => {
    const t = computeStats(contracts, 5, null);
    expect(t.total).toBe(4);
    expect(t.active).toBe(2);
    expect(t.verifying).toBe(1);
    expect(t.disputed).toBe(1);
    expect(t.completed).toBe(1);
    expect(t.totalLocked).toBe(3);
  });
  it('computes earnings and spending per role', () => {
    const t = computeStats(contracts, 5, '0xF');
    expect(t.earnings).toBe(3);
    expect(t.spending).toBe(0);
    const t2 = computeStats(contracts, 5, '0xC');
    expect(t2.earnings).toBe(0);
    expect(t2.spending).toBe(3);
  });
});

describe('links + truncation', () => {
  it('builds explorer links and truncates hashes', () => {
    expect(explorerAddressUrl('0xa')).toContain('/address/0xa');
    expect(explorerTxUrl('0xb')).toContain('/tx/0xb');
    expect(truncateHash('0x1234567890abcdef')).toBe('0x1234…cdef');
  });
});
