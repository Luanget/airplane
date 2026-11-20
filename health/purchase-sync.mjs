import {addConfirmedTransactions,freshData,readFinance,replaceFinance} from '../finance-storage.mjs';
import {purchaseForTransaction} from './purchases.mjs';
import {finishPurchaseUpdate,readPurchaseUpdate,readState,saveState,stagePurchaseUpdate} from './storage.mjs';

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
 const finance=readFinance(account.finance);
 const change=job.change,assistant=change.kind==='assistant';
 const phase=status(finance,change);
 if(phase==='conflict')throw Error('财务记录在另一页面有变更，请核对待同步的账本更新');
 if(phase==='stale'){
  await finishPurchaseUpdate(account,job.id,false);
  throw Error('财务账本已变更，请重新生成候选');
 }
 if(phase==='ready'){
  const next=finance.payload??freshData();
  if(assistant)addConfirmedTransactions(next,change.entries);
  else {
   const {id,after}=change;
   next.transactions=after?next.transactions.map(row=>row.id===id?after:row):next.transactions.filter(row=>row.id!==id);
  }
  try{replaceFinance(account.finance,next,finance.primary);}
  catch(err){
   if(assistant)await finishPurchaseUpdate(account,job.id,false);
   throw err;
  }
 }
 try{return await finishPurchaseUpdate(account,job.id,true);}
 catch(err){
  if(assistant)throw new AssistantSyncPending('财务已保存，健康账本待同步。请继续同步。',{cause:err});
  throw err;
 }
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
  replaceFinance(account.finance,project(payload??freshData()),expected);
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
  const finance=readFinance(account.finance);
  const phase=status(finance,job.change);
  if(phase==='applied'||job.change.kind==='assistant'&&phase==='conflict')
   throw Error('部分或全部财务更新已写入，请先核对并完成同步');
  return finishPurchaseUpdate(account,job.id,false);
 });
}
