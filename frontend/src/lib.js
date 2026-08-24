export const GEN = (n) => BigInt(Math.round(n * 10 ** 18));
export const ATTO = 10n ** 18n;

export function toGen(atto) {
  try {
    return Number(BigInt(atto) / 10n ** 15n) / 1000;
  } catch {
    return 0;
  }
}

export function truncateHash(h, lead = 6, tail = 4) {
  if (!h) return '';
  const s = String(h);
  if (s.length <= lead + tail + 2) return s;
  return `${s.slice(0, lead)}…${s.slice(-tail)}`;
}

export function statusClass(status) {
  switch (status) {
    case 'PAID':
    case 'VERIFIED':
      return 'ok';
    case 'OPEN':
      return 'open';
    case 'DISPUTED':
    case 'FAILED':
      return 'warn';
    case 'VERIFYING':
      return 'live';
    default:
      return '';
  }
}

// Spec badge names for on-chain states
export function statusBadge(status) {
  switch (status) {
    case 'OPEN':
      return 'OPEN';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'SUBMITTED':
      return 'WORK SUBMITTED';
    case 'VERIFYING':
      return 'VERIFYING';
    case 'PAID':
      return 'PAID';
    case 'FAILED':
      return 'VERIFICATION FAILED';
    case 'DISPUTED':
      return 'DISPUTED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return status;
  }
}

export function explorerAddressUrl(addr) {
  return `https://explorer-studio.genlayer.com/address/${addr}`;
}

export function explorerTxUrl(hash) {
  return `https://explorer-studio.genlayer.com/tx/${hash}`;
}

export function stars(avgX10) {
  const n = Number(avgX10) / 10;
  if (!n) return '☆☆☆☆☆';
  const full = Math.round(n);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

export function newContractId() {
  return 'GL-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export function sameAddr(a, b) {
  return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

export function isValidUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Aggregate dashboard stats from a list of on-chain contracts.
export function computeStats(contracts, creditGen, me) {
  const t = {
    total: contracts.length,
    active: 0,
    completed: 0,
    verifying: 0,
    disputed: 0,
    totalLocked: 0,
    earnings: 0,
    spending: 0,
  };
  for (const c of contracts) {
    const budget = toGen(c.budget_atto);
    const mine = sameAddr(me, c.client) || sameAddr(me, c.freelancer);
    if (['OPEN', 'ACCEPTED', 'SUBMITTED', 'VERIFYING'].includes(c.status)) {
      t.active += 1;
      if (mine || !me) t.totalLocked += budget;
    }
    if (c.status === 'VERIFYING') t.verifying += 1;
    if (c.status === 'DISPUTED') t.disputed += 1;
    if (c.status === 'PAID') {
      t.completed += 1;
      if (sameAddr(me, c.freelancer)) t.earnings += budget;
      if (sameAddr(me, c.client)) t.spending += budget;
    }
  }
  t.withdrawable = creditGen;
  return t;
}
