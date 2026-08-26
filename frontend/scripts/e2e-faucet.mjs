// Reproduce the exact browser faucet claim: injected provider signs, SDK broadcasts.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount } from 'viem/accounts';

const FAUCET = '0x5aB77Faab78e9c2578a1473B1326787e51cb2F9e';
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

// the faucet claimer is a fresh wallet (like a visitor)
const claimerPk = generatePrivateKey();
const claimerViem = privateKeyToAccount(claimerPk);
const claimerClient = createClient({ chain: studionet, account: createAccount(claimerPk) });
// fund nothing — visitors have 0 GEN; claim is value-free

const provider = {
  async request({ method, params = [] }) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [claimerViem.address];
    if (method === 'eth_chainId') return '0x' + studionet.id.toString(16);
    if (method === 'wallet_addEthereumChain' || method === 'wallet_switchEthereumChain') return null;
    if (method === 'eth_gasPrice') return await rpc('eth_gasPrice', []);
    if (method === 'eth_getTransactionCount') return await rpc('eth_getTransactionCount', [claimerViem.address, 'pending']);
    if (method === 'eth_sendTransaction') {
      const tx = params[0];
      const nonce = await rpc('eth_getTransactionCount', [claimerViem.address, 'pending']);
      const gasPrice = await rpc('eth_gasPrice', []);
      const serialized = await claimerViem.signTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        nonce: BigInt(nonce),
        gasPrice: BigInt(gasPrice),
        gas: tx.gas ? BigInt(tx.gas) : 1000000n,
        chainId: studionet.id,
        type: 'legacy',
      });
      return await rpc('eth_sendRawTransaction', [serialized]);
    }
    throw new Error('unsupported ' + method);
  },
};

const client = createClient({ chain: studionet, account: claimerViem.address, provider });
console.log('claiming from visitor wallet', claimerViem.address, '…');
try {
  const hash = await client.writeContract({ address: FAUCET, functionName: 'claim', args: [] });
  console.log('claim tx:', hash);
  const r = await client.waitForTransactionReceipt({ hash, retries: 300 });
  console.log('status:', r.status_name);
  const info = await client.readContract({ address: FAUCET, functionName: 'faucet_info', args: [] });
  console.log('claims served now:', Number(info.claim_count));
  const bal = await rpc('eth_getBalance', [claimerViem.address, 'latest']);
  console.log('visitor balance (wei):', bal);
  console.log('BROWSER CLAIM PATH PASS');
} catch (e) {
  console.log('CLAIM FAILED:', String(e?.shortMessage ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
}
