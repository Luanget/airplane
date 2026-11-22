import {addFood,changeFoodMeal,deleteEvent,events,inventoryWithMoves,NUTRIENTS,round,suggestNutritionByInventory,validDate} from '../health/core.mjs';
import {basis,quantityInUnit} from '../health/candidates.mjs';
import {managedFoodPackage,voidPackageFood} from '../health/container-ledger.mjs';
import {revisePackageIntake} from '../health/containers.mjs';
import {recordedPortion} from '../health/food-history.mjs';
import {saveSku} from '../health/inventory.mjs';
import {orderBatchId,recordPurchase,revisePurchase,cents} from '../health/purchases.mjs';
import {eatingState} from '../health/presentation.mjs';
import {same} from '../health/sync-source.mjs';
import {units} from '../health/contract.mjs';

export function ownerSku(state,{id,action,fields,operationId,date}){
 const table=[state.legacy.inventory,state.local.inventory??=[]];
 const all=table.flat();
 const prior=id?all.find(row=>row.id===id):null;
 if(action==='delete'){
  if(!prior)throw Error('找不到食品 ID');
  const used=state.local.stockMoves.some(row=>row.foodId===id)||(state.local.batches??[]).some(row=>row.foodId===id)||
   events(state,'foods').some(row=>row.foodId===id);
  if(used){prior.active=false;return {...prior,status:'archived_with_history'};}
  for(const rows of table){const ix=rows.indexOf(prior);if(ix>=0)rows.splice(ix,1);}
  return null;
 }
 if(action==='add'){
  const equal=row=>String(row.name).normalize('NFKC').trim().toLowerCase()===String(fields.name).normalize('NFKC').trim().toLowerCase();
  const match=all.filter(equal);
  if(match.length===1)return ownerSku(state,{id:match[0].id,action:'update',fields:{...fields,active:fields.active??true},operationId,date});
  if(match.length>1||prior)throw Error('存在同名食品或重复 ID，请指定原食品 ID');
  const sku=saveSku(state,{...fields,...fields.nutrition,id:id??operationId,basisUnit:fields.basisUnit??fields.unit,
   basisAmount:fields.basisAmount??100,price:fields.pricePerUnit});
  if(fields.quantity===undefined&&fields.qty===undefined)return sku;
  id=sku.id;
 }
 const original=all.find(row=>row.id===id)??state.local.inventory.find(row=>row.id===id);
 if(!original)throw Error('找不到食品 ID');
 const unit=fields.unit??original.unit,quantity=fields.quantity??fields.qty;
 if(!units.includes(unit)&&unit!==original.unit)throw Error('库存单位无效');
 if(unit!==original.unit||quantity!==undefined){
  if(!Number.isFinite(quantity)||quantity<0||!validDate(date))throw Error('请给盘点后的当前库存数量与单位；旧量不需要等值换算');
  const before=inventoryWithMoves(state).find(row=>row.id===id);
  const previousUnit=original.unit;
  (original.stockHistory??=[]).push({operationId,date,unit:previousUnit,quantity:before.qty,baseline:original.qty,
   unitDescription:original.unitDescription??null,priceBasis:original.priceBasis??null,newUnit:unit,newQuantity:quantity});
  for(const row of [...state.local.stockMoves,...(state.local.batches??[]),...(state.local.containers??[])]){
   if(row.foodId!==id||row.stockArchived)continue;
   Object.assign(row,{stockArchived:true,historicalUnit:previousUnit,archivedBy:operationId});
  }
  for(const order of state.local.purchases??[])for(const item of order.items)
   if(item.foodId===id&&!item.stockUnit)item.stockUnit=previousUnit;
  const shopping=state.local.shoppingList?.find(row=>row.foodId===id);
  if(shopping&&unit!==previousUnit){
   original.stockHistory.at(-1).previousShoppingQuantity=shopping.quantity;
   state.local.shoppingList=state.local.shoppingList.filter(row=>row.foodId!==id);
  }
  original.qty=0;original.unit=unit;original.unitDescription=unit;
  if(unit!==previousUnit){
   original.piecesPerPack=null;original.pack=null;original.packageKind=null;original.pricePerUnit=null;original.priceBasis=unit;
  }
  state.local.stockMoves.push({id:operationId+':count',foodId:id,date,delta:quantity,unit,opening:true,ownerCount:true,
   reason:'所有者实盘',createdAt:new Date().toISOString()});
 }
 const {id:ignored,qty,quantity:count,stockHistory,inventoryUnit,...details}=fields;
 const updated={...original,...details,nutrition:{...original.nutrition,...details.nutrition},unit};
 if(fields.basisAmount!==undefined||fields.basisUnit!==undefined){
  if(!(updated.basisAmount>0)||!units.includes(updated.basisUnit))throw Error('请提供有效的营养基准份量和单位');
  updated.standard=updated.basisAmount+' '+updated.basisUnit;updated.nutritionBasis='custom';
 }
 if(NUTRIENTS.some(key=>updated.nutrition[key]!==null&&updated.nutrition[key]!==undefined&&
  (!Number.isFinite(updated.nutrition[key])||updated.nutrition[key]<0)))throw Error('营养值须为非负数或空值');
 Object.assign(original,updated);
 return inventoryWithMoves(state).find(row=>row.id===id);
}

export function ownerFood(state,{id,action,fields,operationId,date}){
 let prior=id?events(state,'foods').find(row=>row.id===id):null;
 if(action==='delete'){deleteEvent(state,'foods',id);return {state,value:null};}
 const effective=prior?eatingState(prior):'actual';
 const status=fields.status??(effective==='unknown'?'actual':effective);
 const amount=Object.hasOwn(fields,'amount')?fields.amount:prior?.amount??null;
 const unit=Object.hasOwn(fields,'amountUnit')?fields.amountUnit:prior?.amountUnit??null;
 const measureChanged=!!prior&&(amount!==(prior.amount??null)||unit!==(prior.amountUnit??null));
 const skuChanged=!!prior&&Object.hasOwn(fields,'foodId')&&fields.foodId!==(prior.foodId??null);
 const moves=state.local.stockMoves.filter(move=>move.linkedFoodId===id&&!move.stockArchived&&move.delta<0);
 const archived=prior&&state.local.stockMoves.some(move=>move.stockArchived&&move.linkedFoodId===id)&&!moves.length;
 const link=prior&&!archived&&managedFoodPackage(state,id);
 const packageLink=link&&!link.journal.some(row=>row.type==='void'&&row.target===link.event.id);
 const keepingPackage=packageLink&&!skuChanged&&status==='actual';
 const packageCorrection=keepingPackage&&measureChanged&&unit===prior.amountUnit&&amount>0;
 if(packageCorrection){
  state=revisePackageIntake(state,{foodId:id,id:operationId+':quantity',amount,unit,meal:fields.meal});
  prior=events(state,'foods').find(row=>row.id===id);
 }
 const foodId=Object.hasOwn(fields,'foodId')?fields.foodId:prior?.foodId;
 const sku=inventoryWithMoves(state).find(food=>food.id===foodId);
 const detachedPackage=packageLink&&(!keepingPackage||measureChanged&&!packageCorrection);
 if(detachedPackage){
  // A later weigh-in can still depend on the old physical observation. Keep its
  // journal and the unassigned discrepancy, but drop its dietary association.
  const related=managedFoodPackage(state,id);
  if(related)voidPackageFood(state,id,prior.date);
 }
 let row={...prior,...fields,id:id??operationId,date:fields.date??prior?.date??date,status,
  name:fields.name??(skuChanged?sku?.name:undefined)??prior?.name,
  meal:fields.meal??prior?.meal??'未分餐',amount,amountUnit:unit,
  portion:fields.portion??(measureChanged||!prior?amount!=null&&unit?amount+' '+unit:'':prior?.portion??'')};
 if(!validDate(row.date)||!row.name?.trim()||!['actual','plan','cancelled'].includes(status)||amount!==null&&(!Number.isFinite(amount)||amount<0))
  throw Error('请提供有效的饮食日期、名称、份量和状态');
 if(status!=='actual')delete row.actual;
 if(skuChanged)for(const key of ['foodGroup','category']){
  if(!Object.hasOwn(fields,key))delete row[key];
 }
 if(skuChanged||detachedPackage){
  if(!Object.hasOwn(fields,'batchId'))row.batchId=null;
  if(!Object.hasOwn(fields,'weighing'))delete row.weighing;
 }
 const fromPlan=status==='actual'&&effective==='plan';
 const usesStock=(!archived||skuChanged)&&status==='actual'&&!!sku&&
  (moves.length||prior?.stockAssociation==='pending'||fields.stockQty>0||Object.hasOwn(fields,'foodId')||fromPlan||detachedPackage);
 const finalBatch=Object.hasOwn(fields,'batchId')?fields.batchId:row.date===prior?.date?row.batchId:null;
 let ratio=null;
 if(measureChanged&&prior&&!skuChanged&&!packageCorrection){
  try{
   const before=recordedPortion(prior),newAmount=quantityInUnit(sku,amount,unit,before.unit);
   if(newAmount!==null)ratio=newAmount/before.amount;
  }catch{/* Keep unknown measures unknown. */}
 }
 const labelAmount=sku&&amount>0&&unit?quantityInUnit(sku,amount,unit,basis(sku)[1]):null;
 const label=labelAmount!=null?suggestNutritionByInventory(sku,labelAmount):null;
 const nutrition=Object.fromEntries(NUTRIENTS.map(key=>{
  const value=prior?.nutrition?.[key]??null;
  if(Object.hasOwn(fields.nutrition??{},key))return [key,fields.nutrition[key]];
  if(!prior||skuChanged)return [key,label?.[key]??null];
  if(!measureChanged||packageCorrection)return [key,value];
  return [key,value!==null&&ratio!==null?round(value*ratio,2):label?.[key]??null];
 }));
 if(Object.values(nutrition).some(value=>value!==null&&(!Number.isFinite(value)||value<0)))throw Error('营养值须为非负数或空值');
 const rebuild=fromPlan||skuChanged||detachedPackage||fields.stockQty!==undefined||fields.batchId!==undefined||
  measureChanged&&!packageCorrection||prior&&row.date!==prior.date&&moves.length&&!keepingPackage||status!==effective&&moves.length;
 if(prior&&!rebuild){
  row={...row,nutrition};
  changeFoodMeal(state,row,row.meal);
  return {state,value:row};
 }
 const stockQty=usesStock?(Object.hasOwn(fields,'stockQty')?fields.stockQty:
  measureChanged||skuChanged||!prior||detachedPackage?quantityInUnit(sku,amount,unit,sku.unit):
   row.stockQty??quantityInUnit(sku,amount,unit,sku.unit)):null;
 const cost=Object.hasOwn(fields,'cost')?fields.cost:skuChanged||detachedPackage||prior?.costSource==='inventory'?null:row.cost;
 const saved=addFood(state,{...row,...nutrition,stockQty,cost,batchId:finalBatch,containerCorrection:!!packageLink},prior?.id,row.id);
 if(stockQty!==null&&saved.uncertainty==='缺少库存单位换算依据')saved.uncertainty='';
 if(usesStock&&stockQty===null){
  saved.stockAssociation='pending';
  if(!saved.uncertainty)saved.uncertainty='缺少库存单位换算依据';
 }
 // Keep source and application-specific metadata on an effective historical edit.
 for(const [key,value] of Object.entries(row))
  if(!Object.hasOwn(saved,key)&&!['stockAssociation','weighing','actual'].includes(key)&&value!==undefined)saved[key]=value;
 return {state,value:saved};
}

export function ownerPurchase(state,{id,action,fields,operationId}){
 if(action==='add'){
  const items=fields.items??[];
  const totalCents=fields.totalCents??(items.length&&items.every(row=>row.costCents!=null)?
   items.reduce((sum,row)=>sum+row.costCents,0):null);
  return {state,value:recordPurchase(state,{...fields,id:id??operationId,items,totalCents,stockOnly:!fields.financeId},fields.linkedTxn)};
 }
 const before=state.local.purchases?.find(row=>row.id===id);
 if(!before)throw Error('找不到采购 ID');
 const {itemEdits,...data}=fields;
 if(itemEdits){
  const items=before.items.map((row,index)=>({...row,batchId:orderBatchId(before,row,index)}));
  for(const edit of itemEdits){
   const index=items.findIndex(row=>row.batchId===edit.batchId);
   if(edit.action==='add')items.push({...edit.fields,batchId:edit.batchId??operationId+':lot:'+items.length});
   else if(index<0)throw Error('找不到指定采购明细批次');
   else if(edit.action==='delete')items.splice(index,1);
   else if(edit.action==='update')items[index]={...items[index],...edit.fields,batchId:items[index].batchId};
   else throw Error('采购明细操作无效');
  }
  if(!items.length)return ownerPurchase(state,{id,action:'delete',fields:{},operationId});
  data.items=items;
 }
 if(data.items&&fields.totalCents===undefined&&data.items.every(row=>row.costCents!=null))
  data.totalCents=data.items.reduce((sum,row)=>sum+row.costCents,0);
 const revised=revisePurchase(state,id,action==='delete'?null:data,{receiptUndo:true,owner:true});
 if(action==='delete')for(const receipt of revised.next.local.agentReceipts??[]){
  if(receipt.purchaseId!==id)continue;
  receipt.purchaseLinkHistory=[...(receipt.purchaseLinkHistory??[]),{id,operationId,detached:true}];
  receipt.purchaseId=null;
 }
 return {state:revised.next,value:revised.order};
}

export function reconcileFinanceLinks(state,before,after){
 const old=new Map(before.transactions.map(row=>[row.id,row])),current=new Map(after.transactions.map(row=>[row.id,row]));
 for(const order of state.local.purchases??[]){
  if(order.status==='cancelled')continue;
  const changed=id=>!same(old.get(id),current.get(id));
  if(order.financeId&&changed(order.financeId)&&current.get(order.financeId)?.type!=='expense'){
   if(old.has(order.financeId))(order.financeLinkHistory??=[]).push({id:order.financeId,detached:true});
   order.financeId=null;order.stockOnly=true;
  }
  if(order.financeIds?.some(changed)){
   const previous=order.financeIds;
   order.financeIds=previous.filter(id=>!changed(id)||current.get(id)?.type==='expense');
   if(!order.financeIds.length){
    (order.financeLinkHistory??=[]).push({ids:previous,receiptId:order.receiptId,detached:true});
    const receipt=state.local.agentReceipts?.find(row=>row.id===order.receiptId);
    if(receipt?.purchaseId===order.id)receipt.purchaseId=null;
    delete order.receiptId;delete order.financeIds;order.stockOnly=true;
   }
  }
  const links=order.financeIds??[order.financeId].filter(Boolean);
  if(links.some(changed)&&links.every(id=>current.get(id)?.type==='expense')){
   const paid=links.reduce((sum,id)=>sum+cents(current.get(id).amount),0);
   if(order.paymentCents!==paid)order.paymentCents=paid;
  }
 }
 for(const receipt of state.local.agentReceipts??[]){
  if(receipt.cancelled||!receipt.financeIds.some(id=>!same(old.get(id),current.get(id))))continue;
  const ids=receipt.financeIds.filter(id=>{
   const row=current.get(id);return row?.receiptKey===receipt.id&&row.type===(receipt.refundOf?'income':'expense');
  });
  const total=ids.reduce((sum,id)=>sum+cents(current.get(id).amount),0);
  if(!ids.length){receipt.cancelled=true;continue;}
  if(total!==receipt.total||ids.length!==receipt.financeIds.length){
   (receipt.settlementHistory??=[]).push({total:receipt.total,financeIds:receipt.financeIds});
   Object.assign(receipt,{financeIds:ids,total});
  }
  if(receipt.purchaseId){
   const order=state.local.purchases?.find(row=>row.id===receipt.purchaseId);
   if(order?.receiptId===receipt.id)order.financeIds=ids;
  }
  const dates=[...new Set(ids.map(id=>current.get(id).date))];
  if(dates.length===1)receipt.date=dates[0];
  if(dates.length>1)receipt.financeDates=dates;
 }
}

const indexRows=rows=>new Map((rows??[]).map(row=>[row.id,row]));
const rowEdits=(before,after)=>{
 const old=indexRows(before),next=indexRows(after);
 return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>{
  const a=old.get(id),b=next.get(id);
  return same(a,b)?[]:[{id,before:a,after:b,action:!a?'add':!b?'delete':'update'}];
 });
};
function fieldsChanged(before,after){
 if(!before)return {...after};
 return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(after)])]
  .filter(key=>!same(before[key],after[key])).map(key=>[key,after[key]]));
}
const foodState=row=>['plan','cancelled','actual'].includes(row.status)?row.status:eatingState(row);
const foodDependencies=['status','actual','amount','amountUnit','foodId','stockQty','batchId','date'];
const tablesWithDerivedRows=['batches','stockMoves','containers','containerEvents'];
function overlayRows(calculated,before,requested){
 const rows=indexRows(calculated);
 for(const {id,before:old,after} of rowEdits(before,requested)){
  if(!after){rows.delete(id);continue;}
  const row=rows.get(id);
  if(!old||!row){rows.set(id,after);continue;}
  const fields=fieldsChanged(old,after);
  for(const [key,value] of Object.entries(fields))if(value===undefined)delete row[key];else row[key]=value;
 }
 return [...rows.values()];
}

// Resolve JSON paths on the unmodified draft first. Only then apply stable-ID
// domain edits, once, across the whole Patch batch.
export async function reconcileOwnerHealthPatch(before,requested,{date,operationId,applyOrder}){
 const previousFoods=indexRows(events(before,'foods')),requestedFoods=events(requested,'foods');
 const edits=rowEdits([...previousFoods.values()],requestedFoods);
 const foodEdits=edits.filter(({before,after})=>!before||!after||foodDependencies.some(key=>!same(before[key],after[key])));
 const orders=rowEdits(before.local.purchases,requested.local.purchases);
 const rebase=inventoryWithMoves(before);
 const unitChanged=[...requested.legacy.inventory,...(requested.local.inventory??[])].filter(row=>
  rebase.some(prior=>prior.id===row.id&&prior.unit!==row.unit));
 if(!orders.length&&!foodEdits.length&&!unitChanged.length)return requested;

 let next=structuredClone(requested);
 const touched=new Set(foodEdits.map(row=>row.id));
 const restoreRows=(rows,original)=>[
  ...rows.filter(row=>!touched.has(row.id)),...original.filter(row=>touched.has(row.id))];
 next.local.foods=restoreRows(next.local.foods,before.local.foods);
 next.legacy.foods=restoreRows(next.legacy.foods,before.legacy.foods);
 if(before.local.edits?.foods||next.local.edits?.foods){
  const overlay=(next.local.edits??={}).foods??={};
  for(const id of touched){
   if(Object.hasOwn(before.local.edits?.foods??{},id))overlay[id]=before.local.edits.foods[id];
   else delete overlay[id];
  }
 }
 if(orders.length)next.local.purchases=structuredClone(before.local.purchases??[]);
 for(const key of tablesWithDerivedRows){
  if(before.local[key]!==undefined||next.local[key]!==undefined)next.local[key]=structuredClone(before.local[key]??[]);
 }
 const oldInventory=indexRows([...before.legacy.inventory,...(before.local.inventory??[])]);
 for(const row of unitChanged){
  const sku=[...next.legacy.inventory,...(next.local.inventory??[])].find(item=>item.id===row.id);
  const old=oldInventory.get(sku.id),unit=sku.unit,quantity=sku.quantity??(sku.qty!==old.qty?sku.qty:undefined);
  Object.assign(sku,{unit:old.unit,qty:old.qty});delete sku.quantity;
  ownerSku(next,{id:sku.id,action:'update',fields:{unit,quantity},operationId:operationId+':inventory:'+sku.id,date});
 }
 const applyFood=change=>{
  const {id,action,before:old,after}=change;
  const fields=after?fieldsChanged(old,after):{};
  if(after){
   const status=foodState(after);
   fields.status=status==='unknown'?'actual':status;
   if(old&&Object.hasOwn(fields,'nutrition'))fields.nutrition=Object.fromEntries(
    Object.entries(fieldsChanged(old.nutrition,after.nutrition)).map(([key,value])=>[key,value??null]));
   for(const field of ['amount','amountUnit','foodId','stockQty','batchId'])
    if(Object.hasOwn(fields,field)&&fields[field]===undefined)fields[field]=null;
  }
  next=ownerFood(next,{id,action,fields,operationId:operationId+':food:'+id,date}).state;
  if(after){
   const saved=events(next,'foods').find(row=>row.id===id);
   for(const [key,value] of Object.entries(fields))
    if(value===undefined&&!foodDependencies.includes(key)&&key!=='nutrition')delete saved[key];
  }
 };
 // Reductions may free an existing lot before a simultaneous purchase correction.
 const releases=foodEdits.filter(({before,after})=>before&&(!after||
  foodState(before)==='actual'&&(foodState(after)!=='actual'||
   before.foodId===after.foodId&&before.amountUnit===after.amountUnit&&after.amount<before.amount)));
 for(const change of releases)applyFood(change);
 for(const order of orders.filter(row=>row.after&&row.after.status!=='cancelled')){
  const fields=fieldsChanged(order.before,order.after);
  if(fields.items)fields.items=fields.items.map((item,index)=>({...item,batchId:orderBatchId(order.after,item,index)}));
  next=await applyOrder(next,{...order,fields});
 }
 for(const change of foodEdits)if(!releases.includes(change))applyFood(change);
 for(const order of orders.filter(row=>!row.after||row.after.status==='cancelled')){
  if(order.before&&order.before.status!=='cancelled')next=await applyOrder(next,{...order,action:'delete',fields:{}});
  if(!order.after)next.local.purchases=next.local.purchases.filter(row=>row.id!==order.id);
 }
 for(const key of tablesWithDerivedRows)
  if(!same(before.local[key],requested.local[key]))
   next.local[key]=overlayRows(next.local[key],before.local[key],requested.local[key]);
 const orderByRequest=(rows,ordered)=>{
  const positions=new Map(ordered.map((row,index)=>[row.id,index]));
  return rows.sort((a,b)=>(positions.get(a.id)??Infinity)-(positions.get(b.id)??Infinity));
 };
 orderByRequest(next.local.foods,requested.local.foods);
 orderByRequest(next.legacy.foods,requested.legacy.foods);
 if(orders.length)orderByRequest(next.local.purchases,requested.local.purchases??[]);
 return next;
}
