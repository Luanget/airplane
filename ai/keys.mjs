const slot='airplane-openai-credential-v1';
async function deviceRecord(operation, value) {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open(slot,1);
    req.onupgradeneeded=()=>req.result.createObjectStore('credentials');
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('credentials',operation==='get'?'readonly':'readwrite');
      const store=tx.objectStore('credentials');
      const req=operation==='get'?store.get('device'):operation==='put'?store.put(value,'device'):store.delete('device');
      tx.oncomplete=()=>resolve(req.result);
      tx.onabort=()=>reject(tx.error || Error('本机存储不可用'));
    });
  } finally {db.close();}
}
export async function readKey() {
  const row=await deviceRecord('get');
  if (!row) return null;
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv},row.key,row.ciphertext));
}
export async function importKey(text) {
  const value=text.trim();
  if (!/^sk-[A-Za-z0-9_-]{12,8192}$/.test(value)) throw Error('请输入完整的 OpenAI API Key（以 sk- 开头）');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  await deviceRecord('put',{key,iv,ciphertext});
}
export async function forgetKey() {
  await deviceRecord('delete');
}
