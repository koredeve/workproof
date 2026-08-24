// Live dispute test: deliverable clearly fails → AI validators should refund the client.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const CONTRACT_ADDRESS = '0xfB4F90f4C00dDf7f12505A40A12D6536a2d18c96';
const client = createClient({
  chain: studionet,
  account: createAccount(process.env.SMOKE_PRIVATE_KEY),
});
const freelancer = createAccount(generatePrivateKey());
const fClient = createClient({ chain: studionet, account: freelancer });

const DRY = process.env.DRY_JOB_ID;
const jobId = DRY || 'job-dispute-' + Date.now().toString(36);
const write = async (c, fn, args, value) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fresh = createClient({ chain: studionet, account: createAccount(process.env.SMOKE_PRIVATE_KEY) });
      const hash = await fresh.writeContract({
        address: CONTRACT_ADDRESS, functionName: fn, args,
        ...(value !== undefined ? { value } : {}),
      });
      console.log(fn, 'tx hash:', hash);
      await fresh.waitForTransactionReceipt({ hash, retries: 300 });
      const job = await fresh.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_job', args: [args[0]] });
      console.log(fn, 'ok →', job.status);
      return;
    } catch (e) {
      console.log(fn, `attempt ${attempt} failed:`, (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 120), "| details:", String(e?.details ?? "").slice(0, 80));
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 5000 + attempt * 10000 + Math.floor(Math.random() * 4000)));
    }
  }
};

await write(client, 'post_job', [jobId, 'Translate a paragraph to French', 'Deliver a full French translation of the provided English paragraph about climate science. The paragraph is: The ocean absorbs heat and carbon dioxide, slowing atmospheric warming but acidifying marine ecosystems.'], 500000000000000000n);
await write(fClient, 'accept_job', [jobId]);
await write(fClient, 'submit_deliverable', [jobId, 'Sorry, I ran out of time and did not do the translation.']);
await write(client, 'raise_dispute', [jobId]);
console.log('triggering AI arbitration — validators are judging…');
await write(client, 'resolve_dispute', [jobId]);

const job = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_job', args: [jobId] });
console.log('status:', job.status);
console.log('ruling:', job.ruling);
const clientCredit = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'credit_of', args: [client.account.address] });
console.log('client credit (atto):', clientCredit);
if (job.status === 'cancelled' && clientCredit === 500000000000000000n) {
  console.log('DISPUTE TEST PASS — client refunded by AI consensus');
} else {
  console.error('DISPUTE TEST: unexpected outcome');
  process.exit(1);
}
