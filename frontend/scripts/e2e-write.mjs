// End-to-end write test: client posts + approves, freelancer accepts + delivers.
// Requires SMOKE_PRIVATE_KEY env var (the contract owner / client key). Never commit keys.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const CONTRACT_ADDRESS = '0xeD581E0D4f28c7FAc74Ea3D112C630D55d25B7B3';
if (!process.env.SMOKE_PRIVATE_KEY) {
  console.error('Set SMOKE_PRIVATE_KEY to run the write test.');
  process.exit(1);
}

const client = createClient({
  chain: studionet,
  account: createAccount(process.env.SMOKE_PRIVATE_KEY),
});
const freelancer = createAccount(generatePrivateKey());
const fClient = createClient({ chain: studionet, account: freelancer });
console.log('freelancer:', freelancer.address);

const jobId = 'job-e2e-' + Date.now().toString(36);
const write = async (c, fn, args, value) => {
  const hash = await c.writeContract({
    address: CONTRACT_ADDRESS, functionName: fn, args,
    ...(value !== undefined ? { value } : {}),
  });
  await c.waitForTransactionReceipt({ hash, retries: 300 });
  console.log(fn, 'ok');
};

await write(client, 'post_job', [jobId, 'E2E test job', 'Write a haiku about blockchains. The deliverable must contain exactly one haiku (three lines).'], 1000000000000000000n);
await write(fClient, 'accept_job', [jobId]);
await write(fClient, 'submit_deliverable', [jobId, 'Haiku: chains of trust align / validators agree as one / consensus, then calm']);
await write(client, 'approve_work', [jobId]);

const job = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_job', args: [jobId] });
console.log('final status:', job.status);
const credit = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'credit_of', args: [freelancer.address] });
console.log('freelancer credit (atto):', credit);
if (job.status !== 'completed') {
  console.error('E2E FAIL');
  process.exit(1);
}
console.log('E2E PASS');
