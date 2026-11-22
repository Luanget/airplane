import {addConfirmedTransactions,freshData,readFinance,replaceFinance} from '../finance-storage.mjs';
import {purchaseForTransaction} from './purchases.mjs';
import {finishPurchaseUpdate,readOwnerChange,readPurchaseUpdate,readState,saveState,stagePurchaseUpdate} from './storage.mjs';
import {readOwnerPart,samePart,writeOwnerPart} from '../ai/owner-store.mjs';

export const readPendingPurchase=readPurchaseUpdate;
export class AssistantSyncPending extends Error {}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const transaction=(payload,id)=>payload?.transactions.find(row=>row.id===id)??null;
export function projectedExpense(order,updated,before){
 if(!before)return null;
 if(before.type!=='expense')throw Error('原关联账目已改为收入，请先核对财务记录');
 if(!updated)return {id:before.id,before,after:null};
 if(!updated.totalCents)throw Error('有关联支出的订单须保留正金额，或撤销整张订单');
 const after={...before,amount:updated.totalCents/100};
 if(updated.date!==order.date)after.date=updated.date;
 if((updated.time??'')!==(order.time??''))after.time=updated.time??'';
 if(before.note===order.note||before.note==='食品采购')after.note=updated.note||'食品采购';
 return same(before,after)?null:{id:before.id,before,after};
}
function status(finance,change){
 if(change.kind==='receipt'){
  const match=key=>change.pairs.every(pair=>same(transaction(finance.payload,pair.id),pair[key]));
  if(match('after'))return 'applied';
  if(match('before'))return finance.primary===change.expected?'ready':'stale';
  return 'conflict';
 }
 if(change.kind==='assistant'){
  const rows=change.entries.map(entry=>transaction(finance.payload,entry.id));
  if(rows.every((row,index)=>same(row,change.entries[index])))return 'applied';
  if(rows.every(row=>row===null))return finance.primary===change.expected?'ready':'stale';
  return 'conflict';
 }
 const row=transaction(finance.payload,change.id);
 if(same(row,change.after))return 'applied';
 if(same(row,change.before))return 'ready';
 return 'conflict';
}
async function settle(account,job){
 if(job.change.kind==='owner')return settleOwner(account,job);
 const finance=readFinance(account.finance);
 const change=job.change,assistant=change.kind==='assistant',receipt=change.kind==='receipt';
 const phase=status(finance,change);
 if(phase==='conflict')throw Error('财务记录在另一页面有变更，请核对待同步的账本更新');
 if(phase==='stale'){
  await finishPurchaseUpdate(account,job.id,false);
  throw Error('财务账本已变更，请重新生成候选');
 }
 if(phase==='ready'){
  const next=finance.payload??freshData();
  if(assistant)addConfirmedTransactions(next,change.entries);
  else if(receipt){
   const removed=new Set(change.pairs.filter(pair=>pair.before).map(pair=>pair.id));
   next.transactions=next.transactions.filter(row=>!removed.has(row.id));
   addConfirmedTransactions(next,change.pairs.flatMap(pair=>pair.after?[pair.after]:[]));
  }
  else {
   const {id,after}=change;
   next.transactions=after?next.transactions.map(row=>row.id===id?after:row):next.transactions.filter(row=>row.id!==id);
  }
  try{replaceFinance(account.finance,next,finance.primary);}
  catch(err){
   if(assistant)await finishPurchaseUpdate(account,job.id,false);
   if(receipt)throw new AssistantSyncPending('采购待同步：财务写入未完成，请重试同一任务。',{cause:err});
   throw err;
  }
 }
 try{return await finishPurchaseUpdate(account,job.id,true);}
 catch(err){
  if(assistant||receipt)throw new AssistantSyncPending('财务已保存，健康账本待同步。请继续同步。',{cause:err});
  throw err;
 }
}
async function settleOwner(account,job,{cancel=false}={}){
 const parts=job.change.parts;
 try{
  const values=await Promise.all(parts.map(part=>readOwnerPart(account,part)));
  const phase=parts.map((part,index)=>samePart(values[index],part.after)?'after':samePart(values[index],part.before)?'before':'conflict');
  if(cancel||phase.includes('conflict')){
   for(let i=parts.length-1;i>=0;i--)if(phase[i]==='after')await writeOwnerPart(account,parts[i],'after','before');
   const original=await finishPurchaseUpdate(account,job.id,false);
   if(cancel)return original;
   throw Error('其他页面改动了数据，本次已回滚。重新查询后可重试原指令。');
  }
  for(const [i,part] of parts.entries())if(phase[i]==='before')await writeOwnerPart(account,part);
  return await finishPurchaseUpdate(account,job.id,true);
 }catch(error){
  if(!(await readPurchaseUpdate(account)))throw error;
  throw new AssistantSyncPending('所有者事务待恢复：'+error.message,{cause:error});
 }
}
export function updateOwnerLedgers(account,state,expected,{record,parts},guard){
 return locked(account,async()=>{
  const saved=await readOwnerChange(account,record.id);
  if(saved)return saved;
  const pending=await readPurchaseUpdate(account);
  if(pending){
   if(pending.change.kind!=='owner'||pending.change.record.id!==record.id)
    throw new AssistantSyncPending('有一项账本操作待恢复，请用原任务重试或恢复待办。');
   await settleOwner(account,pending);
   return readOwnerChange(account,record.id);
  }
  for(const part of parts)if(!samePart(await readOwnerPart(account,part),part.before))
   throw Error('读取后账本已有变更，请重新查询再编辑。');
  const job=await stagePurchaseUpdate(account,state,expected,{kind:'owner',record,parts},guard);
  await settleOwner(account,job);
  const verified=await readOwnerChange(account,record.id);
  if(!verified)throw Error('未能验证所有者事务回执，请用原任务重试。');
  return verified;
 });
}
export function resumeOwnerLedgers(account,id){
 return locked(account,async()=>{
  const pending=await readPurchaseUpdate(account);
  if(pending?.change.kind==='owner'&&pending.change.record.id===id)await settleOwner(account,pending);
  return readOwnerChange(account,id);
 });
}
function locked(account,fn){
 return globalThis.navigator?.locks?.request('airplane-purchases:'+(account.id??'device'),fn)??fn();
}
export function writeFinanceWithPurchaseCheck(account,expected,transactionIds,project) {
 return locked(account,async()=>{
  if(await readPurchaseUpdate(account))throw Error('有待同步的账本更新，请先在库存页处理');
  const state=transactionIds.length?await readState(account):null;
  const {primary,payload}=readFinance(account.finance);
  if(primary!==expected)throw Error('财务账本已变更，请重新核对');
  for(const id of transactionIds){
   if(purchaseForTransaction(state,id))throw Error('这笔记录已关联采购，请更正或撤销采购订单');
   if(!payload?.transactions.some(row=>row.id===id))throw Error('原记录已变更，请重新核对');
  }
  const receipts=(payload?.transactions??[]).filter(row=>row.receiptKey).map(row=>({...row}));
  const next=project(payload??freshData());
  const byId=new Map(next.transactions.map(row=>[row.id,row]));
  for(const before of receipts){
   const current=byId.get(before.id);
   if(!current||['receiptKey','type','amount','date'].some(key=>!same(before[key],current[key])))
    throw Error('截图订单的关联金额、日期和方向需要整单更正。');
  }
  replaceFinance(account.finance,next,expected);
 });
}
export function deleteUnlinkedTransactions(account,ids,expected) {
 return writeFinanceWithPurchaseCheck(account,expected,ids,payload=>{
  const selected=new Set(ids);
  payload.transactions=payload.transactions.filter(row=>!selected.has(row.id));
  return payload;
 });
}
export async function updatePurchaseLedgers(account,state,expected,change){
 if(!change)return saveState(state,expected,account);
 return locked(account,async()=>{
  const job=await stagePurchaseUpdate(account,state,expected,change);
  return settle(account,job);
 });
}
export function updateAssistantLedgers(account,state,revision,expected,entries){
 return locked(account,async()=>{
  const pending=await readPurchaseUpdate(account);
  if(pending?.change.kind==='assistant'&&same(pending.change.entries.map(row=>row.id),entries.map(row=>row.id)))
   return settle(account,pending);
  if(readFinance(account.finance).primary!==expected)throw Error('财务账本已变更，请重新生成候选');
  const job=await stagePurchaseUpdate(account,state,revision,{kind:'assistant',expected,entries});
  return settle(account,job);
 });
}
export function updateReceiptLedgers(account,state,revision,expected,{id,operation,pairs},guard){
 return locked(account,async()=>{
  const pending=await readPurchaseUpdate(account);
  if(pending){
   if(pending.change.kind!=='receipt'||pending.change.id!==id||pending.change.operation!==operation)
    throw new AssistantSyncPending('另有账本更新待同步，请先处理。');
   return settle(account,pending);
  }
  if(readFinance(account.finance).primary!==expected)throw Error('财务账本已变更，请重新核对。');
  guard?.();
  const change={kind:'receipt',id,operation,expected,pairs};
  const finance=readFinance(account.finance);
  if(!pairs.length||new Set(pairs.map(pair=>pair.id)).size!==pairs.length||status(finance,change)!=='ready')
   throw Error('关联收支与当前账本不一致，请重新核对。');
  const job=await stagePurchaseUpdate(account,state,revision,change,guard);
  return settle(account,job);
 });
}
export function resumeReceiptUpdate(account,taskId){
 return locked(account,async()=>{
  const job=await readPurchaseUpdate(account);
  if(!job||job.change.kind!=='receipt'||job.change.operation!==taskId)return;
  return settle(account,job);
 });
}
export async function resumePurchaseUpdate(account){
 return locked(account,async()=>{
  const job=await readPurchaseUpdate(account);
  return job?settle(account,job):readState(account);
 });
}
export function abandonPurchaseUpdate(account){
 return locked(account,async()=>{
  const job=await readPurchaseUpdate(account);
  if(!job)return readState(account);
  if(job.change.kind==='owner')return settleOwner(account,job,{cancel:true});
  const finance=readFinance(account.finance);
  const phase=status(finance,job.change);
  if(phase==='applied'||['assistant','receipt'].includes(job.change.kind)&&phase==='conflict')
   throw Error('部分或全部财务更新已写入，请先核对并完成同步');
  return finishPurchaseUpdate(account,job.id,false);
 });
}
