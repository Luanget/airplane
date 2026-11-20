import {inventoryWithMoves,makeId,numeric,validDate} from './core.mjs';
import {addBatch} from './inventory.mjs';

export const purchaseTransactionId=p=>p.financeId || 'expense-'+p.id;
export function purchaseForTransaction(state,id) {
 return (state.local.purchases??[]).find(p=>purchaseTransactionId(p)===id);
}
export function cents(value) {
 const n=numeric(value);
 if(n===null || n<0 || !Number.isSafeInteger(Math.round(n*100)) || Math.abs(n*100-Math.round(n*100))>1e-6)
  throw Error('采购金额最多保留两位小数');
 return Math.round(n*100);
}
export function recordPurchase(state,order,transaction) {
 const {id,date,items,totalCents,financeId=null,note=''}=order;
 const all=state.local.purchases??=[];
 const saved={id,date,items,totalCents,financeId,note};
 const existing=all.find(o=>o.id===id);
 if(existing) {
  if(JSON.stringify(existing)!==JSON.stringify(saved))throw Error('该订单已保存，请打开已有采购');
  return existing;
 }
 if(!id || !validDate(date) || !Number.isSafeInteger(totalCents) || totalCents<0 || !items.length)
  throw Error('请检查订单日期、金额和食品');
 const known=items.reduce((n,r)=>n+(r.costCents??0),0);
 if(known>totalCents || items.every(r=>r.costCents!==null)&&known!==totalCents)
  throw Error('商品金额与订单总额不符');
 if(financeId&&(!transaction || transaction.id!==financeId || transaction.type!=='expense' || cents(transaction.amount)!==totalCents))
  throw Error('关联支出与订单总额不符');
 if(financeId&&purchaseForTransaction(state,financeId))throw Error('这笔支出已关联采购');
 const active=new Set(inventoryWithMoves(state).filter(x=>x.active).map(x=>x.id));
 for(const r of items){
  if(!active.has(r.foodId)||!(Number.isFinite(r.quantity)&&r.quantity>0)||
     r.costCents!==null&&(!Number.isSafeInteger(r.costCents)||r.costCents<0)||r.expires&&!validDate(r.expires))
   throw Error('请检查每项食品、数量、金额和保质期');
 }
 items.forEach((r,i)=>addBatch(state,{...r,id:id+'-'+i,date,reason:'订单采购'}));
 all.push(saved);
 return saved;
}
export function newPurchaseId(){return makeId('purchase');}
