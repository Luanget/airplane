import {newState,validateAppState,APP_SCHEMA} from './core.mjs';
const DB_NAME='airplane-health-db-v1'; const STORE='kv'; const KEY='main';
function openDb(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open(DB_NAME,1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });}
export async function readState(){const db=await openDb();try {return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(KEY);req.onsuccess=()=>resolve(req.result||newState());req.onerror=()=>reject(req.error);});}finally{db.close();}}
export async function saveState(state){if(!validateAppState(state))throw Error('不合法的健康数据格式');const db=await openDb();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(state,KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
export function exportState(state){if(!validateAppState(state))throw Error('无法导出：数据格式错误');return JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2);}
export function isAppBackup(obj){return obj?.appType===APP_SCHEMA && validateAppState(obj);}