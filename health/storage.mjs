import {ensureContainers} from './containers.mjs';
import {newState, recoverLegacyPortions, validateAppState} from './core.mjs';

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
  return ensureContainers(recoverLegacyPortions((await readSlot(slot(account),account)) ?? newState()));
}
export async function readRestoreSnapshot(account=globalThis.airplaneAccount) {
  return readSlot(slot(account)+':before-restore',account);
}

// Check the revision and replace the entire batch in one IndexedDB transaction.
export async function saveState(state, expected, account = globalThis.airplaneAccount, snapshot = null, guard = null) {
  ensureContainers(state);
  if (!validateAppState(state)) throw Error('健康数据格式无效');
  const db = await openDb();
  const next = {...state, revision: expected + 1};
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const key = slot(account);
      const req = store.get(key);
      const pending=store.get(purchaseSlot(account));
      let failure;
      pending.onsuccess = () => {
        try {
          if(pending.result)throw Error('有待同步的账本更新，请先在库存页处理');
          if ((unpack(account, req.result)?.revision ?? 0) !== expected)
            throw Error('其他页面已修改账本，请刷新后重试');
          guard?.();
          if(snapshot)store.put(account?.id ? account.seal('health', snapshot) : snapshot,key+':before-restore');
          store.put(account?.id ? account.seal('health', next) : next, key);
        } catch (err) { failure = err; tx.abort(); }
      };
      tx.oncomplete = resolve;
      // A cancelled request can emit error before the transaction aborts.
      // Use the definitive transaction result and retain the original reason.
      tx.onabort = () => reject(failure || tx.error || Error('写入中断'));
    });
    return next;
  } finally { db.close(); }
}
export function exportState(state) {
  if (!validateAppState(state)) throw Error('健康数据格式无效');
  return JSON.stringify({...state, exportedAt:new Date().toISOString()}, null, 2);
}

const purchaseSlot=account=>slot(account)+':purchase-update';
const pack=(account,value)=>account?.id?account.seal('health',value):value;
export function readPurchaseUpdate(account) {return readSlot(purchaseSlot(account),account);}

async function purchaseWrite(account,operation){
 const db=await openDb();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv');
   const current=store.get(slot(account)),pending=store.get(purchaseSlot(account));
   let result,failure;
   pending.onsuccess=()=>{
    try{result=operation(store,unpack(account,current.result),unpack(account,pending.result));}
    catch(err){failure=err;tx.abort();}
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure??tx.error??Error('采购更新已中断'));
   tx.onerror=()=>reject(tx.error);
  });
 }finally{db.close();}
}
export async function replaceRestoreSnapshot(account,expected,next){
 const db=await openDb();
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('kv','readwrite'),store=tx.objectStore('kv');
   const key=slot(account)+':before-restore',request=store.get(key);
   let failure;
   request.onsuccess=()=>{
    try{
     if(JSON.stringify(unpack(account,request.result)??null)!==expected)throw Error('恢复快照已变更，请重新查询');
     if(next===null)store.delete(key);
     else store.put(pack(account,next),key);
    }catch(err){failure=err;tx.abort();}
   };
   tx.oncomplete=resolve;
   tx.onabort=()=>reject(failure??tx.error??Error('无法保存恢复快照'));
  });
 }finally{db.close();}
}
export function stagePurchaseUpdate(account,state,expected,change){
 ensureContainers(state);
 if(!validateAppState(state))throw Error('采购更新后的健康账本无效');
 return purchaseWrite(account,(store,current,pending)=>{
  if(pending||(current?.revision??0)!==expected)throw Error('账本已变更，请刷新后重试');
  const job={id:crypto.randomUUID(),expected,state:{...state,revision:expected+1},change};
  store.put(pack(account,job),purchaseSlot(account));
  return job;
 });
}
export function finishPurchaseUpdate(account,jobId,apply){
 return purchaseWrite(account,(store,current,job)=>{
  if(!job)return current??newState();
  if(job.id!==jobId||(current?.revision??0)!==job.expected)throw Error('待同步的账本更新已变更，请刷新');
  if(apply)store.put(pack(account,job.state),slot(account));
  store.delete(purchaseSlot(account));
  return apply?job.state:current??newState();
 });
}
