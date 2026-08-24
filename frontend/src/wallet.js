// Local, browser-only wallet helper for GenLayer accounts.
// Private keys are encrypted with AES-GCM (PBKDF2-SHA256, 310k iterations)
// and only ever decrypted in memory. Nothing is stored unless the user
// explicitly keeps the (still encrypted) blob for the session.

const ITERATIONS = 310000;

function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptToKeystore(privateKey, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(privateKey)
  );
  return {
    format: 'gl-keystore',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ct),
    createdAt: new Date().toISOString(),
  };
}

export async function decryptKeystore(keystore, password) {
  if (!keystore || keystore.format !== 'gl-keystore') {
    throw new Error('Unrecognized keystore format');
  }
  const key = await deriveKey(password, unb64(keystore.salt));
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(keystore.iv) },
      key,
      unb64(keystore.ciphertext)
    );
  } catch {
    throw new Error('Wrong password or corrupted keystore');
  }
  return new TextDecoder().decode(plain);
}

export function normalizePrivateKey(input) {
  let s = String(input || '').trim();
  if (s.startsWith('0x') || s.startsWith('0X')) s = s.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error('Private key must be 64 hex characters');
  }
  return '0x' + s.toLowerCase();
}

export function downloadKeystore(keystore, address) {
  const blob = new Blob([JSON.stringify(keystore, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gl-keystore--${address}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
