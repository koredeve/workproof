// Simulates MetaMask/Rabby (EIP-1193 provider) and runs the FULL wallet flow:
// eth_requestAccounts → client.connect("studionet") → writeContract with the
// wallet signing eth_sendTransaction. Same code path the browser uses.
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';

const CONTRACT_ADDRESS = '0xeD581E0D4f28c7FAc74Ea3D112C630D55d25B7B3';
const KEY = process.env.SMOKE_PRIVATE_KEY;
if (!KEY) {
  console.error('Set SMOKE_PRIVATE_KEY');
  process.exit(1);
}
const walletAccount = privateKeyToAccount(KEY);
const RPC = studionet.rpcUrls.default.http[0];

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
  return data.result;
}

// --- EIP-1193 mock provider: behaves like MetaMask ---
const provider = {
  async request({ method, params = [] }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
      return [walletAccount.address];
    }
    if (method === 'eth_chainId') {
      return '0x' + studionet.id.toString(16);
    }
    if (method === 'wallet_addEthereumChain' || method === 'wallet_switchEthereumChain') {
      return null; // user approves network add
    }
    if (method === 'eth_gasPrice') {
      return await rpc('eth_gasPrice', params);
    }
    if (method === 'eth_getTransactionCount') {
      return await rpc('eth_getTransactionCount', params);
    }
    if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') {
      const tx = params[0];
      const nonce = await rpc('eth_getTransactionCount', [walletAccount.address, 'pending']);
      const gasPrice = await rpc('eth_gasPrice', []);
      const serialized = await walletAccount.signTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        nonce: BigInt(nonce),
        gasPrice: BigInt(gasPrice),
        gas: tx.gas ? BigInt(tx.gas) : 1_000_000n,
        chainId: studionet.id,
        type: 'legacy',
      });
      return await rpc('eth_sendRawTransaction', [serialized]);
    }
    throw new Error('Mock provider: unsupported method ' + method);
  },
};

// --- The exact browser flow ---
const address = await provider.request({ method: 'eth_requestAccounts' });
console.log('connected wallet:', address[0]);

const client = createClient({
  chain: studionet,
  account: address[0], // string address → SDK routes signing to provider
  provider,
});

try {
  await client.connect('studionet');
  console.log('client.connect("studionet") ok');
} catch (e) {
  console.log('connect warning:', (e?.message ?? String(e)).slice(0, 100));
}

const jobId = 'job-wallet-' + Date.now().toString(36);
console.log('posting job via wallet signature…');
const hash = await client.writeContract({
  address: CONTRACT_ADDRESS,
  functionName: 'post_job',
  args: [jobId, 'Wallet-signed job', 'Posted through a simulated MetaMask provider — the wallet signed this transaction.'],
  value: 500000000000000000n,
});
console.log('tx hash:', hash);
const receipt = await client.waitForTransactionReceipt({ hash, retries: 300 });
console.log('receipt status:', receipt.status_name ?? receipt.status);

const job = await client.readContract({
  address: CONTRACT_ADDRESS,
  functionName: 'get_job',
  args: [jobId],
});
console.log('job status:', job.status, '| budget:', String(job.budget_atto));
if (job.status !== 'open') {
  console.error('WALLET FLOW FAIL');
  process.exit(1);
}
console.log('WALLET FLOW PASS — MetaMask-style signing works end-to-end');
