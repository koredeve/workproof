import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { explorerAddressUrl } from './lib.js';

export const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || '0x6E56eDe7AC0371Ace451618063d50903DdC36A27';
export const ASSISTANT_ADDRESS =
  import.meta.env.VITE_ASSISTANT_ADDRESS || '0xe4d2e6079559f04BE4ef17B7461A48e4F81c20B2';
export const FAUCET_ADDRESS =
  import.meta.env.VITE_FAUCET_ADDRESS || '0x5aB77Faab78e9c2578a1473B1326787e51cb2F9e';
export const EXPLORER_URL = explorerAddressUrl(CONTRACT_ADDRESS);

export const STATUS = {
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  SUBMITTED: 'SUBMITTED',
  VERIFYING: 'VERIFYING',
  VERIFIED: 'VERIFIED',
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

// CriteriaAssistant bindings — AI-drafted criteria for client review.
export async function draftCriteria(client, requestId, brief) {
  const hash = await client.writeContract({
    address: ASSISTANT_ADDRESS,
    functionName: 'draft_criteria',
    args: [requestId, brief],
  });
  await client.waitForTransactionReceipt({ hash, retries: 400 });
  return hash;
}

export async function getDraft(client, requestId) {
  return client.readContract({
    address: ASSISTANT_ADDRESS,
    functionName: 'get_draft',
    args: [requestId],
  });
}

export async function getReceipt(client, hash) {
  return client.waitForTransactionReceipt({ hash, retries: 60 });
}

// WorkFaucet bindings — 0.6 GEN per wallet, once per 7 days, enforced on-chain.
export async function claimFaucet(client) {
  const hash = await client.writeContract({
    address: FAUCET_ADDRESS,
    functionName: 'claim',
    args: [],
  });
  await client.waitForTransactionReceipt({ hash, retries: 400 });
  return hash;
}

export async function faucetInfo(client) {
  return client.readContract({
    address: FAUCET_ADDRESS,
    functionName: 'faucet_info',
    args: [],
  });
}

export async function nextClaimAt(client, who) {
  return client.readContract({
    address: FAUCET_ADDRESS,
    functionName: 'next_claim_at',
    args: [who],
  });
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
