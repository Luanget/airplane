// High-entropy account codes stay on the device. Only a domain-separated bearer
// is sent to the gateway. Its allowlist contains a second hash, never the bearer.
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export async function accountKeys(code) {
  if (!/^[0-9a-f]{64}$/.test(code)) throw Error('账户码应为 64 位小写十六进制字符');
  const bearer = hex(await digest('airplane:api:' + code));
  return {bearer, id: hex(await digest(bearer)), key: await digest('airplane:ledger:' + code)};
}

function base64(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export function privateAccount(keys, nacl, storage) {
  const prefix = 'airplane-account-' + keys.id + ':';
  function seal(slot, value) {
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const data = encoder.encode(JSON.stringify([slot, value]));
    return base64(nonce) + '.' + base64(nacl.secretbox(data, nonce, keys.key));
  }
  function open(slot, encrypted) {
    const [nonce, ciphertext] = encrypted.split('.');
    const plain = nacl.secretbox.open(decode(ciphertext), decode(nonce), keys.key);
    if (!plain) throw Error('账户数据无法解密');
    const [name, value] = JSON.parse(new TextDecoder().decode(plain));
    if (slot !== name) throw Error('账户数据不匹配');
    return value;
  }
  return {id: keys.id, bearer: keys.bearer, seal, open, finance: {
    getItem(slot) { const raw = storage.getItem(prefix + slot); return raw === null ? null : open(slot, raw); },
    setItem(slot, value) { storage.setItem(prefix + slot, seal(slot, String(value))); },
    removeItem(slot) { storage.removeItem(prefix + slot); }
  }};
}
