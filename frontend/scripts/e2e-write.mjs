// End-to-end write test: client posts + sets criteria, freelancer accepts + delivers, verification passes + release.
// Requires SMOKE_PRIVATE_KEY env var (the contract owner / client key). Never commit keys.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const CONTRACT_ADDRESS = '0x6E56eDe7AC0371Ace451618063d50903DdC36A27';
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

const contractId = 'contract-e2e-' + Date.now().toString(36);
const write = async (c, fn, args, value) => {
  const hash = await c.writeContract({
    address: CONTRACT_ADDRESS, functionName: fn, args,
    ...(value !== undefined ? { value } : {}),
  });
  await c.waitForTransactionReceipt({ hash, retries: 300 });
  console.log(fn, 'ok');
};

await write(client, 'post_contract', [contractId, 'E2E test contract', 'Verify landing page and repository deployment.'], 1000000000000000000n);
await write(client, 'set_criteria', [contractId, [
  'The submitted URL is publicly accessible and returns a valid page',
  'The page content is relevant to the agreed contract description',
]]);
await write(fClient, 'accept_contract', [contractId]);
await write(fClient, 'submit_work', [contractId, ['https://example.com'], 'Deployed and public on example.com with verified content.']);
await write(client, 'verify_work', [contractId]);
await write(client, 'approve_release', [contractId]);

const contract = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_contract', args: [contractId] });
console.log('final status:', contract.status);
const credit = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'credit_of', args: [freelancer.address] });
console.log('freelancer credit (atto):', credit);
if (contract.status !== 'PAID') {
  console.error('E2E FAIL');
  process.exit(1);
}
console.log('E2E PASS');
