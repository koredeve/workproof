// Read-only chain smoke test. Run: npm run smoke
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { CONTRACT_ADDRESS } from '../src/genlayer.js';

const client = createClient({ chain: studionet });
const ids = await client.readContract({
  address: CONTRACT_ADDRESS, functionName: 'get_job_ids', args: [],
});
const total = await client.readContract({
  address: CONTRACT_ADDRESS, functionName: 'total_jobs', args: [],
});
console.log('job ids:', JSON.stringify(ids));
console.log('total jobs:', total);
console.log('SMOKE PASS');
