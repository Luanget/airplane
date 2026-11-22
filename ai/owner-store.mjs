import {DRAFT_KEY,PRE_RESTORE_KEY,RECOVERY_KEY,STORAGE_KEY,readFinance,replaceFinance,validateFinanceBackup} from '../finance-storage.mjs';
import {readRestoreSnapshot,replaceRestoreSnapshot} from '../health/storage.mjs';
import {CHAT_HISTORY_KEY} from './context.mjs';
import {CHAT_MODEL_KEY} from './models.mjs';
import {MEMORY_KEY} from './memory.mjs';
import {SKILLS_KEY} from './skills.mjs';
import {THREADS_KEY} from './threads.mjs';
import {taskJournal} from './task-log.mjs';
import {MODEL_PRICES_KEY,replaceUsage,totalUsage} from './usage.mjs';

export const ownerLocalKeys=Object.freeze({
 finance_backup:PRE_RESTORE_KEY,finance_draft:DRAFT_KEY,memory:MEMORY_KEY,skills:SKILLS_KEY,
 conversations:THREADS_KEY,model:CHAT_MODEL_KEY,history:CHAT_HISTORY_KEY,prices:MODEL_PRICES_KEY,
 legacy_skill:'airplane-ai-skill-v1',sync_status:'airplane-health-file-status-v1',
 auto_memory:'airplane-ai-auto-memory-v1'
});
const raw=new Set(['model','history','legacy_skill','auto_memory']);
export const samePart=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const absent=value=>value??null;

export async function readOwnerPart(account,{document,id}){
 if(Object.hasOwn(ownerLocalKeys,document)){
  const value=account.finance.getItem(ownerLocalKeys[document]);
  return value===null||raw.has(document)?value:JSON.parse(value);
 }
 if(document==='finance'){
  const {primary,payload}=readFinance(account.finance);
  return {primary,payload};
 }
 if(document==='health_backup')return absent(await readRestoreSnapshot(account));
 if(document==='local_usage')return absent(await totalUsage());
 if(document==='tasks')return absent(await taskJournal(account).readTask(id));
 if(document==='attachments'&&id?.startsWith('media:'))return absent(await taskJournal(account).readRun(id));
 throw Error('该文档不属于可编辑的当前账户数据');
}

export function ownerFinancePart(payload){
 if(payload===null)return {primary:null,payload:null};
 validateFinanceBackup(payload);
 return {primary:JSON.stringify(payload),payload};
}

export async function writeOwnerPart(account,part,from='before',to='after'){
 const {document,id}=part,before=part[from],after=part[to];
 if(!samePart(await readOwnerPart(account,part),before))throw Error('当前账户的 '+document+' 已变更');
 if(Object.hasOwn(ownerLocalKeys,document)){
  const key=ownerLocalKeys[document];
  if(after===null)account.finance.removeItem(key);
  else account.finance.setItem(key,raw.has(document)?after:JSON.stringify(after));
 }else if(document==='finance'){
  if(after.payload===null){
   account.finance.removeItem(STORAGE_KEY);
   account.finance.removeItem(RECOVERY_KEY);
  }else {
   replaceFinance(account.finance,after.payload,before.primary);
   if(account.finance.getItem(STORAGE_KEY)!==after.primary&&after.primary!==null)account.finance.setItem(STORAGE_KEY,after.primary);
  }
 }else if(document==='health_backup')await replaceRestoreSnapshot(account,JSON.stringify(before),after);
 else if(document==='local_usage')await replaceUsage(before,after);
 else await taskJournal(account).replaceOwnerRecord(document==='tasks'?'tasks':'runs',id,before,after);
 if(!samePart(await readOwnerPart(account,part),after))throw Error('写入后未能核验 '+document);
}
