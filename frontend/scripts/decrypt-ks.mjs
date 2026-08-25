import { readFileSync } from 'fs';
import crypto from 'crypto';
import { keccak256 } from 'viem';

const pw = readFileSync('/Users/mac/.config/genlayer-portfolio/wallet.txt', 'utf8').split('password=')[1].trim();
const ks = JSON.parse(readFileSync('/Users/mac/.genlayer/keystores/portfolio-deployer.json', 'utf8'));
const c = ks.Crypto || ks.crypto;
let derived;
if (c.kdf === 'scrypt') {
  const p = c.kdfparams;
  derived = crypto.scryptSync(Buffer.from(pw), Buffer.from(p.salt, 'hex'), p.dklen, { N: p.n, r: p.r, p: p.p, maxmem: 256 * 1024 * 1024 });
} else {
  const p = c.kdfparams;
  derived = crypto.pbkdf2Sync(Buffer.from(pw), Buffer.from(p.salt, 'hex'), p.c, p.dklen, p.prf.replace('hmac-', 'sha512'));
}
const ct = Buffer.from(c.ciphertext, 'hex');
const mac = keccak256(new Uint8Array([...derived.slice(16, 32), ...ct]));
if (mac !== '0x' + Buffer.from(c.mac, 'hex').toString('hex')) {
  console.error('MAC mismatch — wrong password');
  process.exit(1);
}
const dec = crypto.createDecipheriv(c.cipher, derived.slice(0, 16), Buffer.from(c.cipherparams.iv, 'hex'));
const pt = Buffer.concat([dec.update(ct), dec.final()]);
console.log('0x' + pt.toString('hex'));
