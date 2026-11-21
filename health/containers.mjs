import {apportionedCost,packageCostReference} from './package-price.mjs';
import {addFood,allocateStock,actualFood,batchBalances,changeFoodMeal,events,inventoryWithMoves,isStockReference,makeId,numeric,round,
 sampleNutrientSum,suggestNutritionByInventory,validDate} from './core.mjs';
import {basis,packageInfo,quantityInUnit} from './candidates.mjs';
import {addBatch,auditedDisposition} from './inventory.mjs';
import {hasLaterPackageReading,managedFoodPackage,onShelf,packageJournal,packageReading} from './container-ledger.mjs';
import {normalizeClock} from '../calendar.mjs';

const productRows=state=>[...state.legacy.inventory,...(state.local.inventory??[])];
const closeTypes=['empty','discard'];
const operationId=(containerId,localId)=>containerId+'@'+localId;
const virtualBatch=foodId=>'opening:'+foodId;
const newContainer=(sku,batchId,index,fields)=>({
 id:'package:'+batchId+':'+index,foodId:sku.id,batchId,ordinal:index,...fields
});

function packageSpec(sku){
 const spec=packageInfo(sku);
 const text=[sku.name,sku.unitDescription,sku.standard].join(' ').normalize('NFKC');
 const volume=text.match(/(\d+(?:\.\d+)?)\s*(L|升)(?![a-z])/i);
 const configured=['盒','瓶','袋','包'].includes(sku.packageKind)?sku.packageKind:null;
 const sizeMl=sku.packageUnit==='mL'?numeric(sku.packageSize):volume?1000*Number(volume[1]):null;
 if(sku.unit==='mL'&&sizeMl>0&&(configured||/盒/.test(text)))
  return {kind:configured??'盒',stockMode:'whole',stockAmount:sizeMl,nominal:{value:sizeMl,unit:'mL'}};
 const unit=configured&&sku.unit===configured?configured:sku.unit.match(/^(瓶|盒)/)?.[1];
 if(!unit||/盒当量|个\s*[/／]盒|每盒\s*\d+个/.test(text))return null;
 const labeled=text.match(/每(?:瓶|盒)\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)/i);
 const size=spec.size??(labeled?Number(labeled[1]):/虎邦.*牛肉.*辣椒酱/.test(sku.name)?200:null);
 return {kind:unit,stockMode:'whole',stockAmount:1,nominal:size?{value:size,unit:spec.measure??(labeled&&/ml|毫升/i.test(labeled[2])?'mL':'g')}:null};
}

function append(state,container,event){
 const journal=state.local.containerEvents??=[];
 if(journal.some(row=>row.id===event.id))return;
 const last=journal.findLast(row=>row.containerId===container.id);
 journal.push({...event,containerId:container.id,previousId:last?.id??null});
}
function migratedFood(state,container,food,allUsed,move){
 const date=food.date,info=food.weighing??{};
 const before=numeric(info.before),after=numeric(info.after??info.tare);
 const mass=numeric(food.amountUnit==='g'?food.amount:NaN)??(before!==null&&after!==null&&before>after?round(before-after,3):null);
 const key=operationId(container.id,'legacy:'+food.id);
 const link={date,source:'migration',foodId:food.id,stockApplied:!!move,stockMoveId:move?.id??null,
  costCents:food.cost==null?null:Math.round(food.cost*100)};
 if(before!==null&&after!==null&&before>after){
  append(state,container,{id:key+':start',type:'baseline',date,gross:before,source:'migration'});
  append(state,container,{...link,id:key,type:'eat',grams:mass,gross:after,tare:numeric(info.tare)});
 }else append(state,container,{...link,id:key,type:'net',grams:mass,volumeMl:food.amountUnit==='mL'?food.amount:null});
 if(allUsed)append(state,container,{id:key+':close',type:'empty',date,source:'migration',derivedFrom:key,stockApplied:true});
}

// Existing counts and stock moves are evidence. Only package metadata and
// links are migrated, so restoring a v0.9.10 backup never changes its totals.
export function ensureContainers(state){
 const local=state.local,known=new Map((local.containers??[]).map(row=>[row.id,row]));
 const lots=batchBalances(state);
 const skuRows=productRows(state);
 const add=row=>{
  if(!known.has(row.id)){
   (local.containers??=[]).push(row);known.set(row.id,row);
  }
 };
 for(const sku of skuRows){
  if(!sku.active||isStockReference(sku))continue;
  const skuLots=lots.filter(lot=>lot.foodId===sku.id);
  const disposition=sku.unit==='g'&&auditedDisposition(state,sku);
  if(disposition?.event==='unopened_bottle_given_away'){
   const spec=packageInfo(sku);
   const container=newContainer(sku,virtualBatch(sku.id),0,{kind:'瓶',stockMode:'grossSnapshot',stockAmount:sku.qty,openingBaselinePartial:true,
    nominal:spec.size?{value:spec.size,unit:spec.measure??'g'}:null,origin:'opening'});
   add(container);
   const journal=packageJournal(state,container.id);
   if(!journal.length)append(state,container,{id:operationId(container.id,'audited-opening'),type:'baseline',
    date:disposition.date,gross:sku.qty,source:'migration',reason:'赠送未开封瓶后，沿用剩余开封瓶实测毛重'});
  }
  const defaultSpec=packageSpec(sku);
  if(defaultSpec||skuLots.some(lot=>lot.packageSpec)){
   const receipts=local.stockMoves.filter(row=>row.foodId===sku.id&&!row.batchId&&!row.containerId&&row.delta>0)
    .map(row=>({id:'receipt:'+row.id,quantity:row.delta,costCents:row.costCents,origin:'receipt'}));
   const groups=[...skuLots.filter(lot=>!lot.portion),{id:virtualBatch(sku.id),quantity:sku.qty,costCents:null,origin:'opening'},...receipts];
   for(const lot of groups){
    const declared=lot.packageSpec;
    const spec=declared?packageSpec({...sku,packageKind:declared.kind,packageSize:declared.size,packageUnit:declared.unit}):defaultSpec;
    if(!spec)continue;
    const count=round(lot.quantity/spec.stockAmount,6);
    if(!Number.isSafeInteger(count)||count<=0)continue;
    let allocated=0;
    for(let i=0;i<count;i++){
     const total=lot.costCents==null?null:Math.round((i+1)*lot.costCents/count);
     const price=lot.receiptLine==null&&sku.priceBasis===sku.unit?sku.pricePerUnit:null;
     const costCents=total===null?(price==null?null:Math.round(price*spec.stockAmount*100)):total-allocated;
     allocated=total??0;
     add(newContainer(sku,lot.id,i,{...spec,costCents,origin:lot.origin??'batch'}));
    }
   }
  }
  for(const lot of skuLots.filter(lot=>lot.portion&&sku.unit==='g'))
   add(newContainer(sku,lot.id,0,{kind:'袋',stockMode:lot.estimated?'estimated':'portion',stockAmount:lot.quantity,
    actualNetGrams:lot.estimated?null:lot.quantity,estimatedNetGrams:lot.estimated?lot.quantity:null,
    costCents:lot.costCents,origin:'batch'}));
  const estimated=String(sku.unitDescription??'').normalize('NFKC').match(/剩\s*(\d+)\s*份\s*[×xX]\s*(\d+(?:\.\d+)?)\s*g/);
  if(sku.unit==='g'&&estimated&&!skuLots.length&&numeric(sku.qty)===Number(estimated[1])*Number(estimated[2])){
   for(let i=0;i<Number(estimated[1]);i++)
    add(newContainer(sku,virtualBatch(sku.id),i,{kind:'份',stockMode:'estimated',stockAmount:Number(estimated[2]),
     estimatedNetGrams:Number(estimated[2]),origin:'opening',costCents:null}));
  }
 }
 if(!known.size)return state;
 const covered=new Set((local.containerEvents??[]).map(row=>row.foodId).filter(Boolean));
 const candidates=Object.values(local.edits?.foods??{}).filter(Boolean).concat(local.foods);
 for(const food of candidates){
  if(!food.foodId||!actualFood(food)||!validDate(food.date)||covered.has(food.id))continue;
  const stock=local.stockMoves.filter(row=>row.linkedFoodId===food.id&&row.delta<0);
  const weighed=!!food.weighing;
  const stockAmount=round(stock.reduce((sum,row)=>sum-row.delta,0),6);
  const options=[...known.values()].filter(row=>row.foodId===food.foodId&&(!food.batchId||row.batchId===food.batchId));
  const container=options.find(row=>{
   const sitting=packageReading(row,packageJournal(state,row.id));
   return onShelf(sitting)&&(row.stockMode==='whole'?
    sitting.status==='sealed'&&(stockAmount===row.stockAmount||weighed&&!stockAmount):
    ['portion','estimated'].includes(row.stockMode)&&!!food.batchId&&stock.length>0);
  });
  if(!container)continue;
  if(weighed&&!stockAmount&&options.filter(row=>packageJournal(state,row.id).length>0).length)continue;
  const consumed=stockAmount===container.stockAmount;
  migratedFood(state,container,food,consumed,stock[0]);
  covered.add(food.id);
 }
 return state;
}

export function packagesFor(state,foodId){
 const lots=new Map(batchBalances(state,foodId).map(row=>[row.id,row]));
 const numbers=new Map();
 return (state.local.containers??[]).filter(row=>!foodId||row.foodId===foodId).map(container=>{
  const journal=packageJournal(state,container.id);
  const sku=productRows(state).find(row=>row.id===container.foodId);
  const rate=packageCostReference(sku,container,lots.get(container.batchId));
  const costed={...container,...rate};
  const number=(numbers.get(container.foodId)??0)+1;
  numbers.set(container.foodId,number);
  const view={...packageReading(costed,journal),number};
  const lot=lots.get(container.batchId);
  if(container.stockMode==='portion'||container.stockMode==='estimated'&&container.origin==='batch'){
   if(!lot)return {...view,status:'retired'};
   if(lot.remaining<=0)return {...view,status:onShelf(view)?'empty':view.status,net:0};
   if(view.gross===null&&view.net!=null&&lot.remaining<view.net)view.net=lot.remaining;
  }
  if(container.stockMode==='whole'&&container.origin==='batch'&&(!lot||
   lot.quantity<(container.ordinal+1)*container.stockAmount))return {...view,status:'retired'};
  if(container.origin==='receipt'&&!state.local.stockMoves.some(row=>'receipt:'+row.id===container.batchId))
   return {...view,status:'retired'};
  if(lot?.costCents!=null){
   if(container.stockMode==='portion')view.costCents=lot.costCents;
   else {
    const total=lot.quantity/container.stockAmount,i=container.ordinal;
    view.costCents=Math.round((i+1)*lot.costCents/total)-Math.round(i*lot.costCents/total);
   }
  }
  return view;
 });
}

export function selectPackage(state,{foodId,containerId}){
 const rows=packagesFor(state,foodId).filter(onShelf);
 if(containerId){
  const selection=rows.find(row=>row.id===containerId);
  if(!selection)throw Error('请选择仍在库存的对应包装');
  return selection;
 }
 const open=rows.filter(row=>row.status==='open');
 if(open.length===1)return open[0];
 if(rows.length===1)return rows[0];
 throw Error('请先选择具体包装，避免跨包装比较毛重');
}

const validMass=(value,message)=>{
 const n=numeric(value);
 if(n===null||n<0)throw Error(message);
 return round(n,3);
};
function consumptionCost(container,grams,volumeMl){
 const initial=container.actualNetGrams??(!container.openingBaselinePartial&&container.initialGross!=null&&container.tare!=null?container.initialGross-container.tare:null);
 const volumeBasis=initial==null&&container.nominal?.unit==='mL';
 const reference=initial??container.nominal?.value;
 const amount=volumeBasis?volumeMl:grams;
 return apportionedCost(container.costCents,amount,reference,container.spent+container.lossCost);
}
function foodFields(container,sku,grams,form,costCents){
 const [,unit]=basis(sku);
 const volume=numeric(form.volumeMl);
 const labelQuantity=unit==='mL'&&volume>0?volume:quantityInUnit(sku,grams,'g',unit);
 const nutrients=labelQuantity===null?sampleNutrientSum([]):suggestNutritionByInventory(sku,labelQuantity);
 const cost=costCents==null?null:costCents/100;
 const tracked=container.stockMode==='portion'||container.stockMode==='estimated'&&container.net!=null&&grams<=container.net;
 const realBatch=container.origin==='batch';

 const date=form.date, time=normalizeClock(form.time);
 return {name:form.name?.trim()||sku.name,meal:form.meal||'晚餐',date,time,portion:grams+' g',amount:grams,amountUnit:'g',
  foodId:sku.id,containerId:container.id,batchId:tracked&&realBatch?container.batchId:null,stockQty:tracked?grams:null,cost,
  ...nutrients,quality:labelQuantity===null?'unknown':'label',
  uncertainty:labelQuantity===null?'按体积标示营养，需要实测体积或可靠密度':volume?'采用确认的饮用体积':'',
  ...(form.gross==null?{}:{weighing:{before:container.gross,after:form.gross,tare:null,...(container.unweighedGrams?{interveningGrams:container.unweighedGrams}:{})}})};
}

export function previewPackageAction(state,input){
 const {action='eat',date,foodId,containerId}=input;
 if(!validDate(date))throw Error('请选择记录日期');
 const container=selectPackage(state,{foodId,containerId});
 const sku=productRows(state).find(row=>row.id===container.foodId&&row.active);
 if(!sku)throw Error('该食品已停用');
 const gross=numeric(input.gross),tare=numeric(input.tare)??container.tare;
 if(gross!==null&&(gross<0||tare!==null&&gross<tare))throw Error('毛重不能低于空包装重');
 if(tare!==null&&(tare<0||container.gross!==null&&container.gross<tare&&gross===null))throw Error('请核对空包装重量');
 const event={type:action,date,reason:input.reason?.trim()||'',time:normalizeClock(input.time)};
 const previous=container.gross;
 if(action==='baseline'){
  if(previous!==null)throw Error('该包装已有初始毛重');
  event.gross=validMass(gross,'请填写初始毛重');event.tare=tare;
 }else if(['eat','loss','refill','reweigh'].includes(action)){
  if(previous===null)throw Error('请先记录此包装的初始毛重');
  event.gross=validMass(gross,'请填写最新毛重');
  const difference=round(previous-event.gross-container.unweighedGrams,3);
  if(difference===0&&action!=='reweigh')return {noop:true,container,difference:0};
  if(['eat','loss'].includes(action)&&difference<0)throw Error('毛重增加，请选择补充、称重纠正或另一包装');
  if(action==='refill'&&difference>=0)throw Error('补充后的毛重应增加');
  if(action!=='reweigh')event.grams=Math.abs(difference);
  else if(!event.reason)throw Error('请填写纠正原因');
  event.tare=tare;
 }else if(action==='net'){
  if(container.stockMode==='whole'&&container.status!=='open')throw Error('请先指定已开封包装，或明确吃完一个完整包装');
  event.grams=validMass(input.grams,'请填写食用净重');
  if(event.grams===0)return {noop:true,container,difference:0};
 }else if(action==='portion'){
  if(container.stockMode!=='estimated'||container.gross!==null)throw Error('该份重量已有称重依据');
  event.grams=validMass(input.grams,'请填写确认的当前净重');
 }else if(action==='whole'){
  if(container.stockMode!=='whole'||container.status!=='sealed')throw Error('整包装录入需要一份未开封库存；已开封包装请说明这次吃了多少');
  event.type='net';
  const volume=container.nominal?.unit==='mL'?container.nominal.value:null;
  const grams=container.actualNetGrams??(container.nominal?.unit==='g'?container.nominal.value:null);
  event.volumeMl=volume;event.grams=grams;event.costCents=container.costCents;
 }else if(closeTypes.includes(action)){
  event.gross=gross;
  event.tare=tare;
  if(action==='discard')event.grams=tare!==null&&previous!==null?round(previous-tare,3):container.estimated?null:container.net;
 }else throw Error('无法识别包装操作');
 if((action==='net'||action==='eat'||action==='loss')&&container.stockMode==='portion'&&event.grams>container.net)
  throw Error('食用量超过该份已实称净重');
 let food=null;
 if(action==='whole'){
  const amount=event.volumeMl??event.grams??1,unit=event.volumeMl!=null?'mL':event.grams!=null?'g':container.kind;
  const [,labelUnit]=basis(sku);
  const labelAmount=quantityInUnit(sku,amount,unit,labelUnit);
  const nutrition=labelAmount==null?sampleNutrientSum([]):suggestNutritionByInventory(sku,labelAmount);
  food={name:sku.name,date,time:event.time,meal:input.meal||'晚餐',amount,amountUnit:unit,portion:amount+' '+unit,
   foodId:sku.id,stockQty:null,cost:event.costCents==null?null:event.costCents/100,
   quality:labelAmount==null?'unknown':'label',uncertainty:container.nominal?'完整包装，按包装标称规格记录':'完整包装；未提供净含量',...nutrition};
 }else if(action==='eat'||action==='net'){
  if(container.nominal?.unit==='mL')event.volumeMl=numeric(input.volumeMl)??quantityInUnit(sku,event.grams,'g','mL');
  event.costCents=consumptionCost({...container,tare},event.grams,event.volumeMl);
  event.costEstimated=event.costCents!==null&&(container.costEstimated||container.actualNetGrams==null&&tare==null);
  food={...foodFields(container,sku,event.grams,{...input,gross:event.gross},event.costCents),costEstimated:event.costEstimated};
 }
 if(action==='loss')event.costCents=consumptionCost({...container,tare},event.grams,quantityInUnit(sku,event.grams,'g','mL'));
 if(closeTypes.includes(action))event.costCents=container.costCents==null?null:Math.max(0,container.costCents-container.spent-container.lossCost);
 return {container,event,food,difference:event.grams??null};
}

function settleStock(state,view,event,food){
 if(food?.stockQty>0)return;
 let delta=0;
 if(closeTypes.includes(event.type)){
  if(['whole','grossSnapshot'].includes(view.stockMode))delta=-view.stockAmount;
  if(view.stockMode==='portion')delta=-(batchBalances(state,view.foodId).find(row=>row.id===view.batchId)?.remaining??0);
  if(view.stockMode==='estimated'){
   const lot=batchBalances(state,view.foodId).find(row=>row.id===view.batchId);
   const already=state.local.stockMoves.filter(row=>row.containerId===view.id&&row.delta<0).reduce((sum,row)=>sum-row.delta,0);
   delta=-Math.max(0,lot?.remaining??round(view.stockAmount-already,6));
  }
 }else if(view.stockMode==='portion'&&event.type==='loss')delta=-event.grams;
 else if(view.stockMode==='portion'&&event.type==='refill')delta=event.grams;
 if(!delta)return;
 const lot=state.local.batches?.find(row=>row.id===view.batchId);
 if(delta<0){
  if(!lot){
   const available=inventoryWithMoves(state).find(row=>row.id===view.foodId)?.qty;
   const allocated=batchBalances(state,view.foodId).reduce((sum,row)=>sum+row.remaining,0);
   if(available==null||round(available-allocated,6)<-delta)throw Error('对应包装的期初库存不足，请核对实盘');
  }
  if(view.stockMode!=='grossSnapshot')allocateStock(state,view.foodId,-delta,lot?.id,event.date);
 }
 const move={id:'movement:'+event.id,foodId:view.foodId,batchId:lot?.id??null,containerId:view.id,date:event.date,
  delta,costCents:event.costCents??null,reason:event.type==='empty'?'包装已用完':event.type==='discard'?'包装丢弃':event.type==='refill'?'包装补充':'包装损耗'};
 state.local.stockMoves.push(move);
 event.stockMoveId=move.id;
}

export function confirmPackageAction(current,input){
 if(!input.id)throw Error('缺少称重操作 ID');
 if((current.local.containerEvents??[]).some(row=>row.id===input.id))return {next:current,duplicate:true};
 const next=ensureContainers(structuredClone(current));
 const {container,event,food,noop}=previewPackageAction(next,input);
 if(noop)return {next:current,duplicate:true};
 if(Object.hasOwn(input,'expectedHead')&&container.head!==input.expectedHead)throw Error('该包装已更新，请重看称重预览');
 const saved={...event,id:input.id};
 if(food){
  const matches=events(next,'foods').filter(row=>input.linkFoodId?row.id===input.linkFoodId:
   event.gross!=null&&row.date===food.date&&row.meal===food.meal&&row.foodId===food.foodId&&actualFood(row)&&
   row.amount===food.amount&&row.amountUnit==='g'&&row.weighing?.before===container.gross&&row.weighing?.after===event.gross);
  if(matches.length>1)throw Error('有多条已有饮食符合此次称重，请指定原记录 ID');
  const existing=matches[0];
  if(input.linkFoodId&&!existing)throw Error('原饮食记录已变更');
  if(existing){
   if(managedFoodPackage(next,existing.id))throw Error('这笔饮食已关联一个包装');
   if(existing.foodId!==food.foodId||existing.amount!==food.amount||existing.amountUnit!=='g'||!actualFood(existing))
    throw Error('原饮食与本次称重份量不一致');
   saved.foodId=existing.id;
   saved.costCents=existing.cost==null?null:Math.round(existing.cost*100);
  }else saved.foodId=addFood(next,food,undefined,'food:'+input.id).id;
 }
 settleStock(next,container,saved,food);
 append(next,container,saved);
 if(input.action==='whole'){
  const closure={id:input.id+':close',date:event.date,type:'empty',derivedFrom:saved.id,reason:'完整包装已用完'};
  settleStock(next,container,closure);
  append(next,container,closure);
 }
 return {next,event:saved};
}

export function revisePackageFood(current,input){
 const next=structuredClone(current);
 const related=managedFoodPackage(next,input.foodId);
 if(!related?.container)throw Error('找不到对应的包装称重');
 const {container,event,journal}=related;
 if(!input.id)throw Error('缺少称重操作 ID');
 if(journal.some(row=>row.id===input.id))return {next:current,duplicate:true};
 if(Object.hasOwn(input,'expectedHead')&&journal.at(-1)?.id!==input.expectedHead)
  throw Error('该包装已更新，请重看称重预览');
 if(hasLaterPackageReading(journal,event)||event.type!=='eat')
  throw Error('这笔已成为后续称重基准。可调整餐次或撤销饮食，历史毛重保留供核对');
 const lot=next.local.batches?.find(row=>row.id===container.batchId);
 const product=productRows(next).find(row=>row.id===container.foodId);
 const previous=packageReading({...container,...packageCostReference(product,container,lot)},journal.slice(0,journal.indexOf(event)));
 const gross=validMass(input.gross,'请填写更正后的毛重');
 if(gross>=previous.gross||previous.tare!==null&&gross<previous.tare)throw Error('请核对本次称重范围');
 const grams=round(previous.gross-gross-previous.unweighedGrams,3);
 if(grams<=0)throw Error('此次毛重不支持往前补记更多摄入');
 const old=events(next,'foods').find(row=>row.id===input.foodId);
 if(!old||!actualFood(old))throw Error('原饮食已变化，请重新打开');
 const sku=productRows(next).find(row=>row.id===container.foodId);
 const costCents=consumptionCost(previous,grams);
 const fields=foodFields(previous,sku,grams,{...old,...input,gross},costCents);
 const saved=addFood(next,{...fields,containerCorrection:true},old.id);
 append(next,container,{id:input.id,type:'correct',target:event.id,date:saved.date,reason:input.reason||'更正本次毛重',
  values:{gross,grams,costCents:saved.cost==null?null:Math.round(saved.cost*100)}});
 return {next};
}

export function cookPortions(current,{rawFoodId,rawBatchId,rawGrams,cookedFoodId,weights,date,id=makeId('cooking')}){
 const next=structuredClone(current);
 const rawSku=productRows(next).find(row=>row.id===rawFoodId&&row.active&&row.unit==='g');
 const cooked=productRows(next).find(row=>row.id===cookedFoodId&&row.active&&row.unit==='g');
 if(!rawSku||!cooked||rawFoodId===cookedFoodId||!validDate(date)||!(rawGrams>0)||
  !weights.length||weights.some(value=>!(value>0)))throw Error('请核对生熟食品、原料净重及各袋熟重');
 if(next.local.stockMoves.some(row=>row.actionId===id))return next;
 const allocations=allocateStock(next,rawFoodId,rawGrams,rawBatchId,date);
 const total=round(weights.reduce((sum,value)=>sum+value,0),6);
 const cost=allocations.some(row=>row.costCents==null)?null:allocations.reduce((sum,row)=>sum+row.costCents,0);
 for(const [i,row] of allocations.entries())next.local.stockMoves.push({id:id+':raw:'+i,actionId:id,foodId:rawFoodId,
  batchId:row.batchId??null,date,delta:-row.qty,costCents:row.costCents,reason:'原料转熟制'});
 let cumulative=0,assigned=0;
 for(const [i,quantity] of weights.entries()){
  cumulative+=quantity;
  const allocated=cost===null?null:Math.round(cumulative/total*cost);
  const batch=addBatch(next,{id:id+':'+i,foodId:cookedFoodId,date,quantity,costCents:allocated===null?null:allocated-assigned,
   raw:rawGrams,cooked:total,portion:true,reason:'熟制分装'});
  batch.productionId=id;
  assigned=allocated??0;
 }
 return ensureContainers(next);
}

export function planPackageDay(current,{id,foodId,containerId,date,lunchGrams,dinnerGrams}){
 if(!id||!validDate(date))throw Error('请选择计划日期');
 const next=structuredClone(current),container=selectPackage(next,{foodId,containerId});
 if(!['portion','estimated'].includes(container.stockMode))throw Error('请选择独立分装份');
 const quantities=[numeric(lunchGrams),numeric(dinnerGrams)];
 if(quantities.some(value=>value===null||value<0)||quantities.every(value=>value===0)||
  container.net!=null&&round(quantities[0]+quantities[1],3)>container.net)throw Error('请核对这份食材的午晚餐计划重量');
 const sku=productRows(next).find(row=>row.id===container.foodId);
 const prior=events(next,'foods');
 for(const [i,grams] of quantities.entries()){
  if(!grams||prior.some(row=>row.id==='plan:'+id+':'+i))continue;
  const fields=foodFields(container,sku,grams,{date,meal:i===0?'午餐':'晚餐'},null);
  const row=addFood(next,{...fields,stockQty:null,status:'plan'},undefined,'plan:'+id+':'+i);
  row.plannedContainerId=container.id;
 }
 return next;
}

// Correct the reported quantity without inventing a weigh-in or opening another unit.
export function revisePackageIntake(current,{foodId,id,amount,unit,meal}){
 const next=structuredClone(current);
 const linked=managedFoodPackage(next,foodId);
 const row=events(next,'foods').find(item=>item.id===foodId);
 if(!id||!linked?.container||!row||!actualFood(row))throw Error('找不到原包装饮食');
 if(linked.journal.some(op=>op.id===id))return next;
 const {container,event,journal}=linked;
 if(row.amountUnit!==unit||!(row.amount>0&&amount>0))throw Error('请使用原记录的单位更正该次摄入');
 const portion=round(amount,3)+' '+unit,ratio=amount/row.amount;
 const nutrition=Object.fromEntries(Object.entries(row.nutrition).map(([key,value])=>
  [key,value==null?null:round(value*ratio,2)]));
 const note=event.type==='eat'?'摄入量已更正，保留原实测毛重':row.uncertainty;
 const values={grams:unit==='g'?amount:event.grams??null,volumeMl:unit==='mL'?amount:event.volumeMl??null};
 if(container.stockMode==='whole'){
  changeFoodMeal(next,{...row,amount,portion,nutrition,uncertainty:note},meal||row.meal);
  values.costCents=row.cost==null?null:Math.round(row.cost*100);
 }else{
  const before=packageReading(container,journal.slice(0,journal.indexOf(event)));
  if(unit!=='g')throw Error('分装份更正需要使用克');
  const cents=consumptionCost(before,amount);
  const saved=addFood(next,{...row,...nutrition,amount,portion,meal:meal||row.meal,stockQty:amount,
   containerId:container.id,cost:cents!=null?cents/100:null,containerCorrection:true},row.id);
  values.costCents=saved.cost==null?null:Math.round(saved.cost*100);
 }
 append(next,container,{id,type:'correct',target:event.id,date:row.date,values,reason:'更正已记录摄入量'});
 return next;
}
