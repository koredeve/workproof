import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { explorerAddressUrl } from './lib.js';

export const CONTRACT_ADDRESS = '0xfB4F90f4C00dDf7f12505A40A12D6536a2d18c96';
export const EXPLORER_URL = explorerAddressUrl(CONTRACT_ADDRESS);

export const STATUS = {
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  SUBMITTED: 'SUBMITTED',
  VERIFYING: 'VERIFYING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  DISPUTED: 'DISPUTED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
};

export function makeClient(privateKey) {
  const opts = { chain: studionet };
  if (privateKey) opts.account = createAccount(privateKey);
  return createClient(opts);
}

export async function listContractIds(client) {
  const res = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_contract_ids',
    args: [],
  });
  return (res && res.ids) || [];
}

export async function readContractState(client, id) {
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'get_contract',
    args: [id],
  });
}

export async function readCredit(client, who) {
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: 'credit_of',
    args: [who],
  });
}

export async function readReputation() {
  // reserved: cross-contract reputation read lands with the passport module
  return { avg_rating_x10: 0, count: 0, source: 'none' };
}

export async function writeAndWait(client, functionName, args, value) {
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    ...(value !== undefined ? { value } : {}),
  });
  await client.waitForTransactionReceipt({ hash, retries: 400 });
  return hash;
}

// Parse the on-chain per-criterion verdict JSON into a typed shape.
export function parseCriteriaVerdict(jsonStr) {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => ({
      index: Number(item?.index ?? 0),
      result: ['PASS', 'FAIL', 'UNVERIFIABLE'].includes(item?.result)
        ? item.result
        : 'UNVERIFIABLE',
      reason: String(item?.reason ?? ''),
    }));
  } catch {
    return [];
  }
}
