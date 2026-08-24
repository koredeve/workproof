// Full WorkProof lifecycle on StudioNet with REAL validator adjudication.
import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const CONTRACT_ADDRESS = '0xfB4F90f4C00dDf7f12505A40A12D6536a2d18c96';
const client = createClient({
  chain: studionet,
  account: createAccount(process.env.SMOKE_PRIVATE_KEY),
});
const freelancer = createAccount(generatePrivateKey());
const fClient = createClient({ chain: studionet, account: freelancer });

const id = 'GL-E2E-' + Date.now().toString(36).toUpperCase();
const write = async (c, fn, args, value) => {
  const hash = await c.writeContract({
    address: CONTRACT_ADDRESS, functionName: fn, args,
    ...(value !== undefined ? { value } : {}),
  });
  await c.waitForTransactionReceipt({ hash, retries: 300 });
  console.log(fn, 'ok');
};

console.log('1. posting contract + funding escrow…');
await write(client, 'post_contract', [id, 'Verify example.com landing page', 'The freelancer must demonstrate evidence retrieval against a live public web page.'], 300000000000000000n);

console.log('2. setting acceptance criteria…');
await write(client, 'set_criteria', [id, [
  'The submitted URL is publicly accessible and returns a web page',
  'The page content mentions the word Example',
]]);

console.log('3. freelancer accepts…');
await write(fClient, 'accept_contract', [id]);

console.log('4. freelancer submits evidence…');
await write(fClient, 'submit_work', [id, ['https://example.com'], 'The evidence URL points to a live public web page that mentions Example.']);

console.log('5. running GenLayer verification — validators fetch evidence and score criteria…');
await write(client, 'verify_work', [id]);

const c = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'get_contract', args: [id] });
console.log('status:', c.status);
console.log('verdict:', c.verdict_overall);
console.log('criteria results:', c.verdict_criteria);
console.log('reasoning:', c.verdict_reasoning);
const credit = await client.readContract({ address: CONTRACT_ADDRESS, functionName: 'credit_of', args: [freelancer.address] });
console.log('freelancer credit:', credit);

if (c.status === 'PAID' && c.verdict_overall === 'PASSED' && String(credit) === "300000000000000000") {
  console.log('E2E PASS — per-criterion verification settled on-chain');
} else {
  console.error('E2E: unexpected outcome');
  process.exit(1);
}
