import {readFinance,replaceFinance} from '../finance-storage.mjs';
import {finishPurchaseUpdate,readPurchaseUpdate,readState,saveState,stagePurchaseUpdate} from './storage.mjs';

export const readPendingPurchase=readPurchaseUpdate;
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
function status(payload,change){
 const row=transaction(payload,change.id);
 if(same(row,change.after))return 'applied';
 if(same(row,change.before))return 'ready';
 return 'conflict';
}
async function settle(account,job){
 const finance=readFinance(account.finance);
 const phase=status(finance.payload,job.change);
 if(phase==='conflict')throw Error('关联支出在另一页面有变更，请核对后再处理待确认采购');
 if(phase==='ready'){
  const {id,after}=job.change;
  finance.payload.transactions=after?finance.payload.transactions.map(row=>row.id===id?after:row):finance.payload.transactions.filter(row=>row.id!==id);
  replaceFinance(account.finance,finance.payload,finance.primary);
 }
 return finishPurchaseUpdate(account,job.id,true);
}
function locked(account,fn){
 return globalThis.navigator?.locks?.request('airplane-purchases:'+(account.id??'device'),fn)??fn();
}
export async function updatePurchaseLedgers(account,state,expected,change){
 if(!change)return saveState(state,expected,account);
 return locked(account,async()=>{
  const job=await stagePurchaseUpdate(account,state,expected,change);
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
  if(status(finance.payload,job.change)==='applied')
   throw Error('财务更新已写入，请完成待确认采购');
  return finishPurchaseUpdate(account,job.id,false);
 });
}
