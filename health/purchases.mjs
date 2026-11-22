import {normalizeClock} from '../calendar.mjs';
import {inventoryWithMoves,makeId,numeric,validDate,round,assertBalances} from './core.mjs';
import {addBatch} from './inventory.mjs';
import {packageJournal} from './container-ledger.mjs';

export const purchaseTransactionIds=p=>p.financeIds?.length?p.financeIds:[p.financeId||'expense-'+p.id];
export const purchaseTransactionId=p=>purchaseTransactionIds(p)[0];
export function purchaseForTransaction(state,id) {
 return (state.local.purchases??[]).find(p=>p.status!=='cancelled'&&purchaseTransactionIds(p).includes(id));
}
export function cents(value) {
 const n=numeric(value);
 if(n===null || n<0 || !Number.isSafeInteger(Math.round(n*100)) || Math.abs(n*100-Math.round(n*100))>1e-6)
  throw Error('采购金额最多保留两位小数');
 return Math.round(n*100);
}
export function recordPurchase(state,order,transaction) {
 const {id,date,items,totalCents,financeId=null,note='',time,financeIds,receiptId,stockOnly,sourceEvidence,stockSignature}=order;
 const all=state.local.purchases??=[];
 const clock=normalizeClock(time);
 const saved={id,date,items,totalCents,financeId,note,...(clock?{time:clock}:{}),
  ...(receiptId?{receiptId,financeIds}: {}),...(stockOnly?{stockOnly:true,sourceEvidence,stockSignature}: {})};
 const existing=all.find(o=>o.id===id);
 if(existing) {
  if(JSON.stringify(existing)!==JSON.stringify(saved))throw Error('该订单已保存，请打开已有采购');
  return existing;
 }
 validateOrder(state,saved);
 if(receiptId){
  const ids=Array.isArray(transaction)?transaction.map(row=>row.id):[];
  if(!financeIds?.length||new Set(financeIds).size!==financeIds.length||
   financeIds.length!==ids.length||financeIds.some(id=>!ids.includes(id)||purchaseForTransaction(state,id))||
   transaction.some(tx=>tx.type!=='expense'||tx.receiptKey!==receiptId)||
   transaction.reduce((sum,row)=>sum+cents(row.amount),0)<totalCents)
   throw Error('截图采购与关联支出不一致');
 }
 if(financeId&&(!transaction || transaction.receiptKey || transaction.id!==financeId || transaction.type!=='expense' || cents(transaction.amount)!==totalCents))
  throw Error('关联支出与订单总额不符');
 if(financeId&&purchaseForTransaction(state,financeId))throw Error('这笔支出已关联采购');
 items.forEach((r,i)=>addBatch(state,{...r,id:orderBatchId(saved,r,i),date,time:clock,reason:'订单采购'}));
 all.push(saved);
 return saved;
}
export const unknownPurchaseTotal=order=>order.totalCents===null&&order.stockOnly===true&&!order.financeId&&!order.receiptId;
function validateOrder(state,order) {
 const {id,date,items,totalCents}=order;
 if(!id || !validDate(date) || !unknownPurchaseTotal(order)&&(!Number.isSafeInteger(totalCents)||totalCents<0) || !items.length)
  throw Error('请检查订单日期、金额和食品');
 const known=items.reduce((n,r)=>n+(r.costCents??0),0);
 if(totalCents!==null&&(known>totalCents || items.every(r=>r.costCents!==null)&&known!==totalCents))
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
function usedPackages(state,batchId){
 return (state.local.containers??[]).filter(row=>row.batchId===batchId&&packageJournal(state,row.id).length>0);
}
function removeUnusedTree(state,batchId,{archive=false}={}) {
 const ids=new Set();
 let preserve=false;
 const visit=id=>{
  if(ids.has(id))throw Error('批次来源无效');
  ids.add(id);
  const children=childrenOf(state,id);
  if(usedPackages(state,id).length){
   if(!archive)throw Error('该批次已有包装称重或消耗，请先核对包装历史');
   preserve=true;
  }
  const onlySplits=usageOf(state,id).every(move=>{
   const parts=children.filter(b=>b.id.startsWith(move.id+'-'));
   return parts.length>0&&Math.abs(parts.reduce((sum,b)=>sum+b.quantity,0)+move.delta)<1e-6;
  });
  if(!onlySplits){
   if(!archive)throw Error('该批次已有摄入、丢弃或盘点。请先更正这些记录，再移除该项');
   preserve=true;
  }
  for(const child of children)visit(child.id);
 };
 visit(batchId);
 if(preserve){
  const units=new Map(inventoryWithMoves(state).map(row=>[row.id,row.unit]));
  for(const row of [...state.local.batches,...state.local.stockMoves,...(state.local.containers??[])]){
   if(!ids.has(row.batchId??row.id)||row.stockArchived)continue;
   Object.assign(row,{stockArchived:true,historicalUnit:units.get(row.foodId)??null,archivedBy:'purchase:'+batchId});
  }
  return true;
 }
 state.local.batches=state.local.batches.filter(b=>!ids.has(b.id));
 if(state.local.containers)state.local.containers=state.local.containers.filter(row=>!ids.has(row.batchId));
 state.local.stockMoves=state.local.stockMoves.filter(m=>!ids.has(m.batchId));
}

// Work on a copy so a failed correction cannot partially change the ledger.
export function revisePurchase(current,id,fields,{receiptUndo=false,owner=false}={}) {
 const next=structuredClone(current),orders=next.local.purchases??[];
 const order=orders.find(x=>x.id===id);
 if(!order||order.status==='cancelled')throw Error('采购已撤销或不在此账本');
 if(order.receiptId&&!owner&&(!receiptUndo||fields))throw Error('截图采购关联整单支出，请通过原对话撤销或核对后更正');
 const updated=fields?{...order,...fields,time:normalizeClock(fields.time??order.time),id,
  financeId:owner&&Object.hasOwn(fields,'financeId')?fields.financeId:order.financeId}:null;
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
   const archived=removeUnusedTree(next,batchId,{archive:owner});
   if(revised){
    if(archived)revised.batchId=makeId('purchase-lot');
    else addBatch(next,{...revised,id:batchId,date:updated.date,time:updated.time,reason:'采购更正'});
   }
   continue;
  }
  if(owner&&updated.date===order.date&&updated.time===normalizeClock(order.time)&&
   revised.quantity===line.quantity&&revised.costCents===line.costCents&&revised.expires===line.expires)continue;
  const usage=usageOf(next,batchId);
  if(usedPackages(next,batchId).some(row=>row.stockMode==='whole'&&(row.ordinal+1)*row.stockAmount>revised.quantity))
   throw Error('修改后的数量会丢失已有称重或消耗的包装');
  if(usage.some(m=>m.date<updated.date))throw Error('采购日期晚于已有的消耗或分装日期');
  Object.assign(batch,{date:updated.date,quantity:revised.quantity,costCents:revised.costCents,expires:revised.expires});
  Object.assign(receipt,{date:updated.date,delta:revised.quantity});
  if(updated.time)receipt.time=updated.time;
  else delete receipt.time;
  recostBatch(next,batch,costMeals);
 }
 for(const row of items){
  changedFoods.add(row.foodId);
  if(!originals.has(row.batchId))addBatch(next,{...row,id:row.batchId,date:updated.date,time:updated.time,reason:'采购更正'});
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

// Attach a later paid receipt to lots already received, retaining their IDs and movements.
export function linkStockPurchase(state,order,items,{receiptId,financeIds,note}){
 if(!order?.stockOnly||order.status==='cancelled'||order.receiptId||order.financeId||order.items.length!==items.length)
  throw Error('请选择仍未关联财务的入库单。');
 const remaining=[...items];
 const matched=order.items.map((line,index)=>{
  const ix=remaining.findIndex(other=>other.foodId===line.foodId&&other.quantity===line.quantity);
  if(ix<0)throw Error('订单食品或数量与原入库单不一致。');
  const [hit]=remaining.splice(ix,1);
  if(line.costCents!==null&&hit.costCents!==null&&line.costCents!==hit.costCents)throw Error('实付明细与原批次金额不一致，请核对。');
  return {...line,batchId:orderBatchId(order,line,index),costCents:hit.costCents??line.costCents,receiptLine:hit.receiptLine};
 });
 const totalCents=matched.reduce((sum,row)=>sum+(row.costCents??0),0);
 const {next}=revisePurchase(state,order.id,{items:matched,totalCents,note});
 const linked=next.local.purchases.find(row=>row.id===order.id);
 Object.assign(linked,{receiptId,financeIds});
 return next;
}
