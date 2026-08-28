// Live dispute test: deliverable clearly fails → AI validators should refund the client.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const CONTRACT_ADDRESS = '0x6E56eDe7AC0371Ace451618063d50903DdC36A27';
const client = createClient({
  chain: studionet,
  account: createAccount(process.env.SMOKE_PRIVATE_KEY),
});
const freelancer = createAccount(generatePrivateKey());
const fClient = createClient({ chain: studionet, account: freelancer });

const DRY = process.env.DRY_CONTRACT_ID;
const contractId = DRY || 'contract-dispute-' + Date.now().toString(36);
const write = async (c, fn, args, value) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fresh = createClient({ chain: studionet, account: c.account });
      const hash = await fresh.writeContract({
        address: CONTRACT_ADDRESS, functionName: fn, args,
        ...(value !== undefined ? { value } : {}),
      });
      console.log(fn, 'tx hash:', hash);
      await fresh.waitForTransactionReceipt({ hash, retries: 300 });
      const contract = await fresh.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_contract', args: [args[0]] });
      console.log(fn, 'ok →', contract.status);
      return;
    } catch (e) {
      console.log(fn, `attempt ${attempt} failed:`, (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 120), "| details:", String(e?.details ?? "").slice(0, 80));
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 5000 + attempt * 10000 + Math.floor(Math.random() * 4000)));
    }
  }
};

await write(client, 'post_contract', [contractId, 'Translate a paragraph to French', 'Deliver a full French translation of the climate science paragraph.'], 500000000000000000n);
await write(client, 'set_criteria', [contractId, [
  'The submitted evidence contains an accurate French translation of the climate science paragraph',
  'The translation is publicly accessible at the submitted evidence URL',
]]);
await write(fClient, 'accept_contract', [contractId]);
await write(fClient, 'submit_work', [contractId, ['https://example.com'], 'Submitted placeholder evidence without the actual translation.']);
await write(client, 'verify_work', [contractId]);
await write(fClient, 'open_dispute', [contractId, 'The automated evaluation missed the translated text in the evidence footer.']);
console.log('triggering AI arbitration — validators are judging under immutable criteria…');
await write(client, 'resolve_dispute', [contractId]);

const contract = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_contract', args: [contractId] });
console.log('status:', contract.status);
console.log('verdict reasoning:', contract.verdict_reasoning);
const clientCredit = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'credit_of', args: [client.account.address] });
console.log('client credit (atto):', clientCredit);
if (contract.status === 'REFUNDED' && clientCredit >= 500000000000000000n) {
  console.log('DISPUTE TEST PASS — client refunded by AI consensus');
} else {
  console.error('DISPUTE TEST: unexpected outcome');
  process.exit(1);
}
