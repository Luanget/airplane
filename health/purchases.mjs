import {normalizeClock} from '../calendar.mjs';
import {inventoryWithMoves,makeId,numeric,validDate,round,assertBalances} from './core.mjs';
import {addBatch} from './inventory.mjs';

export const purchaseTransactionId=p=>p.financeId || 'expense-'+p.id;
export function purchaseForTransaction(state,id) {
 return (state.local.purchases??[]).find(p=>p.status!=='cancelled'&&purchaseTransactionId(p)===id);
}
export function cents(value) {
 const n=numeric(value);
 if(n===null || n<0 || !Number.isSafeInteger(Math.round(n*100)) || Math.abs(n*100-Math.round(n*100))>1e-6)
  throw Error('采购金额最多保留两位小数');
 return Math.round(n*100);
}
export function recordPurchase(state,order,transaction) {
 const {id,date,items,totalCents,financeId=null,note='',time}=order;
 const all=state.local.purchases??=[];
 const saved={id,date,items,totalCents,financeId,note,...(normalizeClock(time)?{time:normalizeClock(time)}:{})};
 const existing=all.find(o=>o.id===id);
 if(existing) {
  if(JSON.stringify(existing)!==JSON.stringify(saved))throw Error('该订单已保存，请打开已有采购');
  return existing;
 }
 validateOrder(state,saved);
 if(financeId&&(!transaction || transaction.id!==financeId || transaction.type!=='expense' || cents(transaction.amount)!==totalCents))
  throw Error('关联支出与订单总额不符');
 if(financeId&&purchaseForTransaction(state,financeId))throw Error('这笔支出已关联采购');
 items.forEach((r,i)=>addBatch(state,{...r,id:orderBatchId(saved,r,i),date,reason:'订单采购'}));
 all.push(saved);
 return saved;
}
function validateOrder(state,{id,date,items,totalCents}) {
 if(!id || !validDate(date) || !Number.isSafeInteger(totalCents) || totalCents<0 || !items.length)
  throw Error('请检查订单日期、金额和食品');
 const known=items.reduce((n,r)=>n+(r.costCents??0),0);
 if(known>totalCents || items.every(r=>r.costCents!==null)&&known!==totalCents)
  throw Error('商品金额与订单总额不符');
 const active=new Set(inventoryWithMoves(state).filter(x=>x.active).map(x=>x.id));
 for(const r of items){
  if(!active.has(r.foodId)||!(Number.isFinite(r.quantity)&&r.quantity>0)||
     r.costCents!==null&&(!Number.isSafeInteger(r.costCents)||r.costCents<0)||r.expires&&!validDate(r.expires))
   throw Error('请检查每项食品、数量、金额和保质期');
 }
}
export const orderBatchId=(order,item,index)=>item.batchId??order.id+'-'+index;

export function newPurchaseId(){return makeId('purchase');}

function usageOf(state,batchId) {
 return state.local.stockMoves.filter(m=>m.batchId===batchId&&m.delta<0);
}
function childrenOf(state,batchId) {
 return state.local.batches.filter(b=>b.parent===batchId);
}
function linkedFoods(state) {
 return [...state.local.foods,...Object.values(state.local.edits?.foods??{}).filter(Boolean)];
}
function allocatedCost(moves) {
 return !moves.length||moves.some(m=>m.costCents==null)?null:moves.reduce((sum,m)=>sum+m.costCents,0)/100;
}
function recostBatch(state,batch,remainingFoods) {
 let quantity=batch.quantity,centsLeft=batch.costCents;
 const children=childrenOf(state,batch.id);
 for(const move of usageOf(state,batch.id)){
  const used=-move.delta;
  if(used>quantity+1e-6)throw Error('修改后的数量低于该批次已使用的数量');
  move.costCents=centsLeft===null?null:Math.round(Math.min(1,used/quantity)*centsLeft);
  quantity=round(quantity-used,6);
  if(centsLeft!==null)centsLeft-=move.costCents;
  if(move.linkedFoodId)remainingFoods.add(move.linkedFoodId);
  const portions=children.filter(b=>b.id.startsWith(move.id+'-'));
  let allocated=0,splitQuantity=0;
  for(const child of portions){
   splitQuantity+=child.quantity;
   const part=move.costCents===null?null:Math.round(splitQuantity/used*move.costCents);
   child.costCents=part===null?null:part-allocated;
   allocated=part??0;
   recostBatch(state,child,remainingFoods);
  }
 }
}
function removeUnusedTree(state,batchId) {
 const ids=new Set();
 const visit=id=>{
  if(ids.has(id))throw Error('批次来源无效');
  ids.add(id);
  const children=childrenOf(state,id);
  const onlySplits=usageOf(state,id).every(move=>{
   const parts=children.filter(b=>b.id.startsWith(move.id+'-'));
   return parts.length>0&&Math.abs(parts.reduce((sum,b)=>sum+b.quantity,0)+move.delta)<1e-6;
  });
  if(!onlySplits)throw Error('该批次已有摄入、丢弃或盘点。请先更正这些记录，再移除该项');
  for(const child of children)visit(child.id);
 };
 visit(batchId);
 state.local.batches=state.local.batches.filter(b=>!ids.has(b.id));
 state.local.stockMoves=state.local.stockMoves.filter(m=>!ids.has(m.batchId));
}

// Work on a copy so a failed correction cannot partially change the ledger.
export function revisePurchase(current,id,fields) {
 const next=structuredClone(current),orders=next.local.purchases??[];
 const order=orders.find(x=>x.id===id);
 if(!order||order.status==='cancelled')throw Error('采购已撤销或不在此账本');
 const updated=fields?{...order,...fields,time:normalizeClock(fields.time??order.time),id,financeId:order.financeId}:null;
 if(updated)validateOrder(next,updated);
 const originals=new Map(order.items.map((r,i)=>[orderBatchId(order,r,i),r]));
 const items=(updated?.items??[]).map(r=>({...r,batchId:r.batchId??makeId('purchase-lot')}));
 const mapped=new Map(items.map(r=>[r.batchId,r]));
 if(mapped.size!==items.length)throw Error('采购行重复，请重新打开订单');
 const changedFoods=new Set(),costMeals=new Set();
 const autoCost=new Set(linkedFoods(next).filter(e=>e&&(e.costSource==='inventory'||
   (e.costSource==null&&e.cost===allocatedCost(next.local.stockMoves.filter(m=>m.linkedFoodId===e.id))))).map(e=>e.id));
 for(const [batchId,line] of originals){
  const batch=next.local.batches?.find(b=>b.id===batchId);
  const receipt=next.local.stockMoves.find(m=>m.batchId===batchId&&m.delta>0);
  if(!batch||!receipt)throw Error('采购批次或入库流水缺失，请先核对原账');
  changedFoods.add(line.foodId);
  const revised=mapped.get(batchId);
  if(!revised||revised.foodId!==batch.foodId){
   removeUnusedTree(next,batchId);
   if(revised)addBatch(next,{...revised,id:batchId,date:updated.date,reason:'采购更正'});
   continue;
  }
  const usage=usageOf(next,batchId);
  if(usage.some(m=>m.date<updated.date))throw Error('采购日期晚于已有的消耗或分装日期');
  Object.assign(batch,{date:updated.date,quantity:revised.quantity,costCents:revised.costCents,expires:revised.expires});
  Object.assign(receipt,{date:updated.date,delta:revised.quantity});
  recostBatch(next,batch,costMeals);
 }
 for(const row of items){
  changedFoods.add(row.foodId);
  if(!originals.has(row.batchId))addBatch(next,{...row,id:row.batchId,date:updated.date,reason:'采购更正'});
 }
 for(const foodId of changedFoods)assertBalances(next,foodId);
 for(const meal of linkedFoods(next)){
  if(meal&&costMeals.has(meal.id)&&autoCost.has(meal.id))
   meal.cost=allocatedCost(next.local.stockMoves.filter(m=>m.linkedFoodId===meal.id));
 }
 const history=[...(order.history??[]),{date:order.date,time:normalizeClock(order.time),totalCents:order.totalCents,note:order.note,items:order.items,changedAt:new Date().toISOString()}];
 Object.assign(order,updated?{...updated,items,history}:{status:'cancelled',history});
 return {next,order:updated?order:null};
}
