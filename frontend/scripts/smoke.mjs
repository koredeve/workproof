// Read-only chain smoke test. Run: npm run smoke
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { CONTRACT_ADDRESS } from '../src/genlayer.js';

const client = createClient({ chain: studionet });
const ids = await client.readContract({
  address: CONTRACT_ADDRESS, functionName: 'get_contract_ids', args: [],
});
const total = await client.readContract({
  address: CONTRACT_ADDRESS, functionName: 'total_contracts', args: [],
});
console.log('contract ids:', JSON.stringify(ids));
console.log('total contracts:', total);
console.log('SMOKE PASS');
