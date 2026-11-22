import {addFood,changeFoodMeal,deleteEvent,events,inventoryWithMoves,NUTRIENTS,round,suggestNutritionByInventory,validDate} from '../health/core.mjs';
import {basis,quantityInUnit} from '../health/candidates.mjs';
import {managedFoodPackage} from '../health/container-ledger.mjs';
import {revisePackageIntake} from '../health/containers.mjs';
import {recordedPortion} from '../health/food-history.mjs';
import {saveSku} from '../health/inventory.mjs';
import {orderBatchId,recordPurchase,revisePurchase,cents} from '../health/purchases.mjs';
import {eatingState} from '../health/presentation.mjs';
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
 const portionChanged=!!prior&&(fields.amount!==undefined||fields.amountUnit!==undefined);
 const archived=prior&&state.local.stockMoves.some(row=>row.stockArchived&&row.linkedFoodId===id);
 const packageLink=prior&&!archived&&managedFoodPackage(state,id);
 if(packageLink&&status==='actual'&&portionChanged&&unit===prior.amountUnit&&amount>0){
  state=revisePackageIntake(state,{foodId:id,id:operationId+':quantity',amount,unit,meal:fields.meal});
  prior=events(state,'foods').find(row=>row.id===id);
 }
 let row={...prior,...fields,id:id??operationId,date:fields.date??prior?.date??date,status,
  meal:fields.meal??prior?.meal??'未分餐',amount,amountUnit:unit,portion:fields.portion??(portionChanged?amount+' '+unit:prior?.portion??'')};
 if(!validDate(row.date)||!row.name?.trim()||!['actual','plan','cancelled'].includes(status))throw Error('请提供有效的饮食日期、名称和状态');
 const sku=inventoryWithMoves(state).find(food=>food.id===row.foodId);
 const movements=state.local.stockMoves.filter(move=>move.linkedFoodId===id&&!move.stockArchived&&move.delta<0);
 const fromPlan=status==='actual'&&effective==='plan';
 const usesStock=!archived&&status==='actual'&&!!sku&&(movements.length||fields.stockQty>0||fields.foodId!==undefined||fromPlan);
 let ratio=null;
 if(portionChanged&&prior&&!(packageLink&&unit===prior.amountUnit)){
  try{
   const before=recordedPortion(prior),newAmount=quantityInUnit(sku,amount,unit,before.unit);
   if(newAmount!==null)ratio=newAmount/before.amount;
  }catch{/* An authoritative new measure does not imply conversion of an unspecified old measure. */}
 }
 const labelAmount=sku&&amount>0&&unit?quantityInUnit(sku,amount,unit,basis(sku)[1]):null;
 const label=!prior&&labelAmount!=null?suggestNutritionByInventory(sku,labelAmount):null;
 const nutrition=Object.fromEntries(NUTRIENTS.map(key=>{
  const value=prior?.nutrition?.[key]??null;
  return [key,Object.hasOwn(fields.nutrition??{},key)?fields.nutrition[key]:value===null?label?.[key]??null:
   ratio!==null?round(value*ratio,2):portionChanged&&!(packageLink&&unit===prior?.amountUnit)?null:value];
 }));
 if(Object.values(nutrition).some(value=>value!==null&&(!Number.isFinite(value)||value<0)))throw Error('营养值须为非负数或空值');
 const rebuild=fromPlan||fields.stockQty!==undefined||fields.foodId!==undefined||fields.batchId!==undefined||portionChanged&&!packageLink||
  prior&&row.date!==prior.date&&movements.length||status!==effective&&movements.length;
 if(prior&&!rebuild&&(status==='actual'||!packageLink)){
  row={...row,nutrition};
  changeFoodMeal(state,row,row.meal);
  return {state,value:row};
 }
 if(packageLink&&status!=='actual'){
  deleteEvent(state,'foods',id);
  if(state.sync?.tombstones)state.sync.tombstones=state.sync.tombstones.filter(row=>row.type!=='foods'||row.id!==id);
  if(state.legacy.foods.some(item=>item.id===id))((state.local.edits??={}).foods??={})[id]=row;
  else state.local.foods.push(row);
  prior=row;
 }
 const stockQty=usesStock?(Object.hasOwn(fields,'stockQty')?fields.stockQty:
  portionChanged||!prior?quantityInUnit(sku,amount,unit,sku.unit):row.stockQty??quantityInUnit(sku,amount,unit,sku.unit)):null;
 const saved=addFood(state,{...row,...nutrition,stockQty,
  cost:Object.hasOwn(fields,'cost')?fields.cost:prior?.costSource==='inventory'?null:row.cost,batchId:fields.batchId??(row.date===prior?.date?row.batchId:null),
  containerCorrection:!!packageLink},prior?.id,row.id);
 if(usesStock&&stockQty===null)saved.stockAssociation='pending';
 for(const key of ['externalId','agentEvidence','sourceRef','planId'])if(row[key]!==undefined)saved[key]=row[key];
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
  if(fields.totalCents===undefined&&items.every(row=>row.costCents!=null))
   data.totalCents=items.reduce((sum,row)=>sum+row.costCents,0);
 }
 const revised=revisePurchase(state,id,action==='delete'?null:data,{receiptUndo:true,owner:true});
 return {state:revised.next,value:revised.order};
}

export function reconcileFinanceLinks(state,before,after){
 const old=new Map(before.transactions.map(row=>[row.id,row])),current=new Map(after.transactions.map(row=>[row.id,row]));
 for(const order of state.local.purchases??[]){
  if(order.status==='cancelled')continue;
  if(order.financeId&&current.get(order.financeId)?.type!=='expense'){
   if(old.has(order.financeId))(order.financeLinkHistory??=[]).push({id:order.financeId,detached:true});
   order.financeId=null;order.stockOnly=true;
  }
  if(order.financeIds?.length){
   const previous=order.financeIds;
   order.financeIds=previous.filter(id=>current.get(id)?.type==='expense');
   if(!order.financeIds.length){
    (order.financeLinkHistory??=[]).push({ids:previous,receiptId:order.receiptId,detached:true});
    delete order.receiptId;delete order.financeIds;order.stockOnly=true;
   }
  }
  const links=order.financeIds??[order.financeId].filter(Boolean);
  if(links.some(id=>JSON.stringify(old.get(id))!==JSON.stringify(current.get(id)))){
   const paid=links.reduce((sum,id)=>sum+cents(current.get(id).amount),0);
   if(order.paymentCents!==paid)order.paymentCents=paid;
  }
 }
 for(const receipt of state.local.agentReceipts??[]){
  if(receipt.cancelled)continue;
  const ids=receipt.financeIds.filter(id=>{
   const row=current.get(id);return row?.receiptKey===receipt.id&&row.type===(receipt.refundOf?'income':'expense');
  });
  const total=ids.reduce((sum,id)=>sum+cents(current.get(id).amount),0);
  if(!ids.length){receipt.cancelled=true;continue;}
  if(total!==receipt.total||ids.length!==receipt.financeIds.length){
   (receipt.settlementHistory??=[]).push({total:receipt.total,financeIds:receipt.financeIds});
   Object.assign(receipt,{financeIds:ids,total});
  }
  const dates=[...new Set(ids.map(id=>current.get(id).date))];
  if(dates.length===1)receipt.date=dates[0];
  if(dates.length>1)receipt.financeDates=dates;
 }
}
