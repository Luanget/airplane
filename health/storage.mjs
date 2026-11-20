import {newState, validateAppState} from './core.mjs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('airplane-health-db-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const slot = account => account?.id ? 'member:' + account.id : 'main';
const unpack = (account, raw) => account?.id && raw ? account.open('health', raw) : raw;
async function readSlot(key,account) {
  const db = await openDb();
  try {
    const raw = await new Promise((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return unpack(account, raw);
  } finally { db.close(); }
}

export async function readState(account=globalThis.airplaneAccount) {
  return (await readSlot(slot(account),account)) ?? newState();
}
export async function readRestoreSnapshot(account=globalThis.airplaneAccount) {
  return readSlot(slot(account)+':before-restore',account);
}

// Check the revision and replace the entire batch in one IndexedDB transaction.
export async function saveState(state, expected, account = globalThis.airplaneAccount, snapshot = null) {
  if (!validateAppState(state)) throw Error('健康数据格式无效');
  const db = await openDb();
  const next = {...state, revision: expected + 1};
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const key = slot(account);
      const req = store.get(key);
      let failure;
      req.onsuccess = () => {
        try {
          if ((unpack(account, req.result)?.revision ?? 0) !== expected)
            throw Error('其他页面已修改账本，请刷新后重试');
          if(snapshot)store.put(account?.id ? account.seal('health', snapshot) : snapshot,key+':before-restore');
          store.put(account?.id ? account.seal('health', next) : next, key);
        } catch (err) { failure = err; tx.abort(); }
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(failure || tx.error || Error('写入中断'));
      tx.onerror = () => reject(tx.error);
    });
    return next;
  } finally { db.close(); }
}
export function exportState(state) {
  if (!validateAppState(state)) throw Error('健康数据格式无效');
  return JSON.stringify({...state, exportedAt:new Date().toISOString()}, null, 2);
}
